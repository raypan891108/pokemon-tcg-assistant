const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const REGION = 'tw';
// Official TW TCG site ("訓練家網站"); www.pokemon.com.tw no longer resolves
const BASE_URL = 'https://asia.pokemon-card.com';
const HOME_URL = `${BASE_URL}/tw/`;
// JSON behind the "現正開放報名的賽事" list on the Asia Championship Series portal
const ENTRY_API_URL = `${BASE_URL}/api/pacs/event/entry/tw/`;
const PORTAL_URL = 'https://trainers-asia.portal-pokemon.com/tw';

const LEAGUE_NAMES = {
  'Great Ball League': '超級球聯盟賽',
  'Ultra Ball League': '高級球聯盟賽',
  'Premier Ball League': '紀念球聯盟賽',
  'Master Ball League': '大師球聯盟賽',
};

// Products page lists newest first; older items aren't "new" products
const MAX_PRODUCTS_PER_TAB = 20;

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-TW,zh;q=0.9',
    },
    timeout: 15000,
  });
  return cheerio.load(data);
}

function generateId(text, region) {
  return `${region}-${crypto.createHash('sha1').update(text).digest('hex').substring(0, 16)}`;
}

function absoluteUrl(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : BASE_URL + url;
}

async function scrapeProducts() {
  const products = [];
  try {
    const $ = await fetchPage(`${HOME_URL}products/`);

    // Tabs: 擴充包 / 構築牌組 / 其他商品 / 周邊道具 — the last one (sleeves, deck boxes) is skipped
    const tabTypes = ['擴充包', '構築組', null];
    $('.products-container').slice(0, tabTypes.length).each((tab, container) => {
      $(container).find('li.products-item').slice(0, MAX_PRODUCTS_PER_TAB).each((_, el) => {
        const name = $(el).find('.products-item-detail .name').text().replace(/\s+/g, ' ').trim();
        const url = $(el).find('.products-item-image a').attr('href');
        const imageUrl = $(el).find('img').attr('src');
        if (!name) return;

        products.push({
          id: generateId(($(el).attr('id') || name) + 'tw-product', REGION),
          name,
          region: REGION,
          type: tabTypes[tab] || detectProductType(name),
          imageUrl: absoluteUrl(imageUrl),
          url: absoluteUrl(url),
          // The products page doesn't show release dates
          releaseDate: parseDate(name),
          description: '',
          source: 'tw-official',
        });
      });
    });
  } catch (e) {
    console.error('[TW Scraper] Products error:', e.message);
  }
  return products;
}

// Homepage news list: each <a.info-column-item> has a title and an Event/Product/Other label.
// The same URL can appear more than once, so dedupe by URL.
async function scrapeEventNews() {
  const $ = await fetchPage(HOME_URL);
  const items = [];
  const seen = new Set();
  $('a.info-column-item').each((_, el) => {
    const category = $(el).find('.info-column-item-category .category').text().trim();
    const url = $(el).attr('href');
    if (category !== 'Event' || !url || seen.has(url)) return;
    seen.add(url);

    // Titles sometimes carry zero-width spaces
    const name = $(el).find('.info-column-item-title').text().replace(/[​\s]+/g, ' ').trim();
    if (name) items.push({ name, url: absoluteUrl(url) });
  });
  return items;
}

function isTournament(name) {
  return /賽|Championship|Masters/i.test(name);
}

async function scrapeEvents() {
  const events = [];
  try {
    for (const { name, url } of await scrapeEventNews()) {
      if (isTournament(name)) continue;
      events.push({
        id: generateId(url + 'tw-event', REGION),
        name,
        region: REGION,
        date: parseDate(name),
        location: '台灣',
        url,
        description: '',
        source: 'tw-official',
      });
    }
  } catch (e) {
    console.error('[TW Scraper] Events error:', e.message);
  }
  return events;
}

// API times are Taiwan local time, e.g. "2026-11-02 12:00:00"
function toTaiwanIso(str) {
  return str ? `${str.replace(' ', 'T')}+08:00` : null;
}

// The API returns one entry per age division; merge divisions held at the same date and venue
async function scrapeEntryTournaments() {
  const { data } = await axios.get(ENTRY_API_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    timeout: 15000,
  });
  const groups = new Map();
  for (const e of data?.success?.events || []) {
    const series = (e.seriesName || '').replace(/\s+(Junior|Senior|Masters?)\s+Division$/i, '').trim();
    const key = [series, e.eventDateStr, e.address].join('|');
    if (!groups.has(key)) groups.set(key, { key, series, entry: e, divisions: [] });
    groups.get(key).divisions.push(e.leagueNameLocal || e.leagueName);
  }

  return Array.from(groups.values()).map(({ key, series, entry: e, divisions }) => {
    // e.g. "Waiting List Entry: 2026-27 Taiwan Premier Ball League TCG Category"
    const waitingList = /^Waiting List Entry:\s*/i.test(series);
    const baseSeries = series.replace(/^Waiting List Entry:\s*/i, '');
    const leagueZh = LEAGUE_NAMES[e.pointGrantTypeName];
    const season = (baseSeries.match(/^(\d{4}-\d{2})/) || [])[1];
    const leagueSlug = (e.pointGrantTypeName || '').toLowerCase().replace(/\s+/g, '-');
    const url = season ? `${PORTAL_URL}/${season}/${leagueSlug ? leagueSlug + '/' : ''}` : `${PORTAL_URL}/`;
    // Drop the postal code and the bracketed street address
    const venue = (e.address || '').split(/[（(]/)[0].replace(/^\d{3,6}\s*/, '').trim();
    const title = leagueZh
      ? baseSeries
          .replace(/Taiwan\s+/, '')
          .replace(e.pointGrantTypeName, leagueZh)
          .replace(/\s*TCG Category/i, '')
          .replace(/Season\s*(\d+)/i, '賽季$1')
      : baseSeries;
    const name = title + (waitingList ? '（候補名額）' : '') + (venue ? ` — ${venue}` : '');

    return {
      id: generateId(key + 'tw-tournament', REGION),
      name,
      region: REGION,
      date: toTaiwanIso(e.eventDateStr),
      deadline: toTaiwanIso(e.entryEndDateStr),
      location: e.address || '台灣',
      registrationUrl: url,
      url,
      description: `組別：${divisions.join('、')}　報名期間：${e.entryStartDateStr} ～ ${e.entryEndDateStr}`,
      source: 'tw-pacs-api',
    };
  });
}

async function scrapeTournaments() {
  const tournaments = [];
  try {
    tournaments.push(...await scrapeEntryTournaments());
  } catch (e) {
    console.error('[TW Scraper] Tournament entry API error:', e.message);
  }
  try {
    for (const { name, url } of await scrapeEventNews()) {
      if (!isTournament(name)) continue;
      // League announcements on the portal are covered by the entry API; videos aren't tournaments
      if (/portal-pokemon\.com|youtu\.?be/.test(url)) continue;
      tournaments.push({
        id: generateId(url + 'tw-tournament', REGION),
        name,
        region: REGION,
        date: parseDate(name),
        deadline: null,
        location: '台灣',
        registrationUrl: url,
        url,
        description: '',
        source: 'tw-official',
      });
    }
  } catch (e) {
    console.error('[TW Scraper] Tournaments error:', e.message);
  }
  return tournaments;
}

function detectProductType(name) {
  if (name.includes('構築') || name.includes('牌組') || name.includes('Theme')) return '構築組';
  if (name.includes('禮盒') || name.includes('Gift')) return '禮盒';
  if (name.includes('擴充')) return '擴充包';
  return '特別組合';
}

function parseDate(text) {
  if (!text) return null;
  const patterns = [
    /(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      try {
        return new Date(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`).toISOString().split('T')[0];
      } catch (_) {}
    }
  }
  return null;
}

module.exports = { scrapeProducts, scrapeEvents, scrapeTournaments };
