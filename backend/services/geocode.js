const axios = require('axios');
const storage = require('./storage');

// Map coordinates for Taiwan tournament venues, looked up on OpenStreetMap (Nominatim) and
// cached in geocode.json. OSM knows few Taiwan house numbers, so each address is tried as
// house number → road → district, and falls back to the city/county centre. `precision`
// says which one matched, so the map can mark approximate spots.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Nominatim's usage policy: an identifying User-Agent and at most one request a second
const HEADERS = {
  'User-Agent': 'pokemon-tcg-assistant/1.0 (+https://github.com/raypan891108/pokemon-tcg-assistant)',
  'Accept-Language': 'zh-TW',
};
const REQUEST_GAP_MS = 1100;
// Approximate matches are looked up again later, in case OSM has learned the address
const RETRY_APPROXIMATE_MS = 30 * 24 * 60 * 60 * 1000;

// County seats, for addresses OSM can't place more closely
const CITIES = {
  臺北市: [25.0375, 121.5637], 新北市: [25.0120, 121.4650], 桃園市: [24.9937, 121.3010],
  臺中市: [24.1477, 120.6736], 臺南市: [22.9997, 120.2270], 高雄市: [22.6273, 120.3014],
  基隆市: [25.1283, 121.7419], 新竹市: [24.8039, 120.9647], 嘉義市: [23.4801, 120.4491],
  新竹縣: [24.8270, 121.0128], 苗栗縣: [24.5602, 120.8214], 彰化縣: [24.0750, 120.5446],
  南投縣: [23.9096, 120.6837], 雲林縣: [23.7092, 120.5413], 嘉義縣: [23.4588, 120.2932],
  屏東縣: [22.6727, 120.4884], 宜蘭縣: [24.7570, 121.7533], 花蓮縣: [23.9910, 121.6114],
  臺東縣: [22.7583, 121.1444], 澎湖縣: [23.5711, 119.5793], 金門縣: [24.4367, 118.3186],
  連江縣: [26.1505, 119.9499],
};
// County-administered cities, for addresses that leave out the county ("宜蘭市新民路…")
const COUNTY_OF = {
  宜蘭市: '宜蘭縣', 竹北市: '新竹縣', 苗栗市: '苗栗縣', 頭份市: '苗栗縣', 彰化市: '彰化縣',
  員林市: '彰化縣', 南投市: '南投縣', 斗六市: '雲林縣', 太保市: '嘉義縣', 朴子市: '嘉義縣',
  屏東市: '屏東縣', 花蓮市: '花蓮縣', 臺東市: '臺東縣', 馬公市: '澎湖縣',
};
const CITY_RE = new RegExp(`^(${Object.keys(CITIES).join('|')})`);

// "Red space多元商務空間(臺北市松山區復興北路15-3號B1)" / "300新竹市東區復中里中央路239號_SOGO…"
// → { city: '臺北市', district: '松山區', road: '復興北路', number: '15-3', lane: false }
function parseAddress(location) {
  let text = (location || '').replace(/台/g, '臺').trim();
  // A venue name followed by the address in brackets: use the address
  const bracketed = text.match(/[（(]([^）)]*[市縣][^）)]*)[）)]/);
  if (bracketed) text = bracketed[1];
  text = text.replace(/^\d{3,6}\s*/, '').replace(/[_\s]+/g, ' ');

  let city = (text.match(CITY_RE) || [])[1];
  let rest = city ? text.slice(city.length) : text;
  // 區 first, so 臺南市新市區 isn't read as 新市
  let district = (rest.match(/^(\S{1,3}?區)/) || rest.match(/^(\S{1,3}?[鄉鎮市])/) || [])[1];
  if (!city && district && COUNTY_OF[district]) city = COUNTY_OF[district];
  if (!city) return null;
  if (district) rest = rest.slice(district.length);

  // Drop the village (復中里, 菜公里) that some addresses put before the road
  rest = rest.replace(/^[^\d\s路街道]{1,3}[里村](?=\S*(?:路|街|大道))/, '');
  const road = (rest.match(/^(\S+?(?:路|街|大道)(?:[一二三四五六七八九十\d]+段)?)/) || [])[1];
  const after = road ? rest.slice(road.length) : '';
  const lane = /^\d+巷/.test(after);
  const number = (after.match(/^(?:\d+巷)?(?:\d+弄)?(\d+(?:[-之][\d一二三四五六七八九十]+)?)號/) || [])[1];
  return { city, district, road, number, lane };
}

// The key a location is cached under: the same address written slightly differently shares one entry
function addressKey(parsed) {
  return [parsed.city, parsed.district, parsed.road, parsed.lane ? null : parsed.number].filter(Boolean).join('|');
}

let cache = null;
let lastRequestAt = 0;
let running = null;

async function loadCache() {
  if (!cache) cache = await storage.getGeocode();
  return cache;
}

// One Nominatim lookup, accepted only inside the expected city (and district, when known)
async function search(query, parsed) {
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const { data } = await axios.get(NOMINATIM, {
    params: { q: query, format: 'jsonv2', countrycodes: 'tw', limit: 3 },
    headers: HEADERS,
    timeout: 15000,
  });
  const match = data.find(r => {
    const place = r.display_name.replace(/台/g, '臺');
    return place.includes(parsed.city) && (!parsed.district || place.includes(parsed.district));
  });
  return match ? [Number(match.lat), Number(match.lon)] : null;
}

async function lookup(parsed) {
  const { city, district, road, number, lane } = parsed;
  const area = [district, city].filter(Boolean).join(', ');
  const attempts = [
    number && road && !lane && { precision: 'address', query: `${number} ${road}, ${area}` },
    road && { precision: 'street', query: `${road}, ${area}` },
    district && { precision: 'district', query: area },
  ].filter(Boolean);
  for (const { precision, query } of attempts) {
    const point = await search(query, parsed);
    if (point) return { lat: point[0], lng: point[1], precision };
  }
  const [lat, lng] = CITIES[city];
  return { lat, lng, precision: 'city' };
}

function isFresh(entry) {
  return entry && (entry.precision === 'address' || entry.precision === 'street'
    || Date.now() - new Date(entry.at).getTime() < RETRY_APPROXIMATE_MS);
}

// Look up every Taiwan tournament venue not cached yet, one request a second. Runs in the
// background after each fetch; a call while one is running waits for that one.
function fillMissing() {
  if (running) return running;
  running = (async () => {
    const c = await loadCache();
    const tournaments = (await storage.getTournaments()).filter(t => t.region === 'tw');
    const pending = new Map();
    for (const t of tournaments) {
      const parsed = parseAddress(t.location);
      if (parsed && !isFresh(c[addressKey(parsed)])) pending.set(addressKey(parsed), parsed);
    }
    let found = 0;
    for (const [key, parsed] of pending) {
      try {
        c[key] = { ...await lookup(parsed), at: new Date().toISOString() };
        found++;
        await storage.saveGeocode(c);
      } catch (e) {
        // Network trouble: leave it uncached so the next fetch tries again
        console.error(`[Geocode] ${key}: ${e.message}`);
      }
    }
    if (pending.size) console.log(`[Geocode] ${found}/${pending.size} venue(s) located`);
  })().finally(() => { running = null; });
  return running;
}

// Add { lat, lng, precision } to the Taiwan tournaments whose venue has been located
async function attach(tournaments) {
  const c = await loadCache();
  return tournaments.map(t => {
    const parsed = t.region === 'tw' && parseAddress(t.location);
    const entry = parsed && c[addressKey(parsed)];
    return entry ? { ...t, geo: { lat: entry.lat, lng: entry.lng, precision: entry.precision } } : t;
  });
}

module.exports = { fillMissing, attach, parseAddress };
