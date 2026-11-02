const axios = require('axios');
const storage = require('./storage');

// Translate English Pokémon card names ("Mega Lucario ex", "Lillie's Clefairy ex") into
// Traditional Chinese or Japanese using PokeAPI's official species names. Trainer and
// energy cards aren't species, so they return null. Lookups are cached in card_names.json.

const API = 'https://pokeapi.co/api/v2';
const SPECIES_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LANGS = { zh: 'zh-hant', ja: 'ja' };

const SUFFIX = /\s+(ex|EX|GX|V|VSTAR|VMAX|V-UNION|BREAK|Prism Star|◇|☆)$/;
const MEGA = { zh: '超級', ja: 'メガ' };
const REGIONS = {
  Alolan: { zh: '阿羅拉', ja: 'アローラ' },
  Galarian: { zh: '伽勒爾', ja: 'ガラル' },
  Hisuian: { zh: '洗翠', ja: 'ヒスイ' },
  Paldean: { zh: '帕底亞', ja: 'パルデア' },
};
// Trainers whose Pokémon appear as "<Name>'s <Pokémon>" cards
const OWNERS = {
  "Lillie's": { zh: '莉莉艾的', ja: 'リーリエの' },
  "N's": { zh: 'N的', ja: 'Nの' },
  "Team Rocket's": { zh: '火箭隊的', ja: 'ロケット団の' },
  "Iono's": { zh: '奇樹的', ja: 'ナンジャモの' },
  "Ethan's": { zh: '阿響的', ja: 'ヒビキの' },
  "Cynthia's": { zh: '竹蘭的', ja: 'シロナの' },
  "Hop's": { zh: '赫普的', ja: 'ホップの' },
  "Marnie's": { zh: '瑪俐的', ja: 'マリィの' },
  "Arven's": { zh: '派帕的', ja: 'ペパーの' },
  "Steven's": { zh: '大吾的', ja: 'ダイゴの' },
  "Misty's": { zh: '小霞的', ja: 'カスミの' },
  "Brock's": { zh: '小剛的', ja: 'タケシの' },
  "Erika's": { zh: '莉佳的', ja: 'エリカの' },
  "Larry's": { zh: '青木的', ja: 'アオキの' },
  "Lucian's": { zh: '梧桐的', ja: 'ゴヨウの' },
};

let cache = null;
// Lookups run in parallel; queue the file writes so two never overlap and garble the JSON
let saving = Promise.resolve();

async function loadCache() {
  if (!cache) cache = { species: [], fetchedAt: null, names: {}, ...(await storage.getCardNames()) };
  return cache;
}

function persist() {
  saving = saving.then(() => storage.saveCardNames(cache)).catch(e => console.error('[Names] save:', e.message));
  return saving;
}

async function speciesSet() {
  const c = await loadCache();
  if (!c.species.length || Date.now() - new Date(c.fetchedAt).getTime() > SPECIES_TTL_MS) {
    const { data } = await axios.get(`${API}/pokemon-species?limit=2000`, { timeout: 15000 });
    c.species = data.results.map(r => r.name);
    c.fetchedAt = new Date().toISOString();
    await persist();
  }
  return new Set(c.species);
}

// "Mr. Mime" → "mr-mime", "Farfetch'd" → "farfetchd", "Flabébé" → "flabebe"
function slugify(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[.'’:]/g, '').trim().replace(/\s+/g, '-');
}

async function speciesName(slug, lang) {
  const c = await loadCache();
  if (!c.names[slug]) {
    const { data } = await axios.get(`${API}/pokemon-species/${slug}`, { timeout: 15000 });
    c.names[slug] = Object.fromEntries(
      Object.entries(LANGS).map(([key, code]) => [key, data.names.find(n => n.language.name === code)?.name || null])
    );
    await persist();
  }
  return c.names[slug][lang];
}

// Split "Lillie's Mega Alolan Vulpix ex" into its parts; species is null if it isn't a Pokémon
async function parse(name) {
  let rest = name.trim();
  const suffix = (rest.match(SUFFIX) || [])[1] || '';
  if (suffix) rest = rest.replace(SUFFIX, '');
  const owner = Object.keys(OWNERS).find(o => rest.startsWith(`${o} `));
  if (owner) rest = rest.slice(owner.length + 1);
  const mega = /^Mega\s/.test(rest);
  if (mega) rest = rest.replace(/^Mega\s+/, '');
  const region = Object.keys(REGIONS).find(r => rest.startsWith(`${r} `));
  if (region) rest = rest.slice(region.length + 1);
  const slug = slugify(rest);
  return { suffix, owner, mega, region, slug: (await speciesSet()).has(slug) ? slug : null };
}

// Full card name in zh/ja, or null when it isn't a Pokémon card
async function translateCardName(name, lang = 'zh') {
  try {
    const p = await parse(name);
    if (!p.slug) return null;
    const species = await speciesName(p.slug, lang);
    if (!species) return null;
    return `${p.owner ? OWNERS[p.owner][lang] : ''}${p.region ? REGIONS[p.region][lang] : ''}${p.mega ? MEGA[lang] : ''}${species}${p.suffix}`;
  } catch (e) {
    console.error(`[Names] ${name}:`, e.message);
    return null;
  }
}

// Deck archetypes are named after their main Pokémon plus extra words
// ("Slowking Seek Inspiration"): translate the longest leading part that's a Pokémon
async function translateDeckName(name, lang = 'zh') {
  const words = name.split(/\s+/);
  for (let n = words.length; n >= 1; n--) {
    const head = await translateCardName(words.slice(0, n).join(' '), lang);
    if (head) return [head, ...words.slice(n)].join(' ');
  }
  return null;
}

module.exports = { translateCardName, translateDeckName };
