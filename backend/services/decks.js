const storage = require('./storage');
const limitless = require('../scrapers/limitless-scraper');
const names = require('./card-names');

const FORMATS = ['standard-jp', 'standard'];
const META_TTL_MS = 12 * 60 * 60 * 1000;
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
// Bumped when cached entries gain fields (v2: Chinese/Japanese names), so older ones are refetched
const CACHE_VERSION = 2;

function isFresh(entry, ttl) {
  return entry?.v === CACHE_VERSION && entry.fetchedAt && Date.now() - new Date(entry.fetchedAt).getTime() < ttl;
}

// Archetype names are English on Limitless; translate the Pokémon part
async function withDeckNames(decks) {
  return Promise.all(decks.map(async d => ({
    ...d,
    nameZh: await names.translateDeckName(d.name, 'zh'),
    nameJa: await names.translateDeckName(d.name, 'ja'),
  })));
}

// Japanese names come from Limitless's Japanese list; Chinese only exists for Pokémon cards
async function withCardNames(sections) {
  return Promise.all(sections.map(async s => ({
    ...s,
    cards: await Promise.all(s.cards.map(async c => ({
      ...c,
      nameZh: /^Pok/i.test(s.heading) ? await names.translateCardName(c.name, 'zh') : null,
    }))),
  })));
}

// Cached meta ranking; serves stale data if Limitless can't be reached
async function getMeta(format = 'standard-jp', force = false) {
  if (!FORMATS.includes(format)) throw new Error('不支援的賽制');
  const cache = await storage.getDecks();
  const meta = cache.meta?.[format];
  if (!force && isFresh(meta, META_TTL_MS)) return meta;

  try {
    const decks = await limitless.scrapeMetaDecks(format);
    if (decks.length === 0) throw new Error('沒有抓到牌組資料');
    const entry = { v: CACHE_VERSION, format, fetchedAt: new Date().toISOString(), decks: await withDeckNames(decks) };
    const latest = await storage.getDecks();
    await storage.saveDecks({ ...latest, meta: { ...latest.meta, [format]: entry } });
    return entry;
  } catch (e) {
    if (meta) return { ...meta, stale: true };
    throw e;
  }
}

async function getSampleList(deckId, format = 'standard-jp') {
  if (!/^\d+$/.test(String(deckId))) throw new Error('牌組 ID 不正確');
  const key = `${format}:${deckId}`;
  const cache = await storage.getDecks();
  const cached = cache.lists?.[key];
  if (isFresh(cached, LIST_TTL_MS)) return cached;

  try {
    const list = await limitless.scrapeSampleList(deckId, format);
    if (!list) throw new Error('找不到範例牌表');
    const entry = { ...list, sections: await withCardNames(list.sections), v: CACHE_VERSION, fetchedAt: new Date().toISOString() };
    const latest = await storage.getDecks();
    await storage.saveDecks({ ...latest, lists: { ...latest.lists, [key]: entry } });
    return entry;
  } catch (e) {
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}

module.exports = { FORMATS, getMeta, getSampleList };
