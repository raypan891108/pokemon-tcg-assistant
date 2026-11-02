const axios = require('axios');
const storage = require('./storage');
const yuyutei = require('../scrapers/yuyutei-scraper');

const MAX_HISTORY = 200;
const RATE_TTL_MS = 6 * 60 * 60 * 1000;
let cachedRate = null;

// JPY→TWD from a free FX API, cached; falls back to the rate in settings
async function getJpyToTwd() {
  if (cachedRate && Date.now() - cachedRate.at < RATE_TTL_MS) return cachedRate.rate;
  try {
    const { data } = await axios.get('https://open.er-api.com/v6/latest/JPY', { timeout: 10000 });
    const rate = data?.rates?.TWD;
    if (rate) {
      cachedRate = { rate, at: Date.now() };
      return rate;
    }
  } catch (e) {
    console.error('[Market] FX rate error:', e.message);
  }
  return Number(storage.getSettings().jpyToTwd) || 0.21;
}

function toTwd(jpy, rate) {
  return jpy != null ? Math.round(jpy * rate) : null;
}

async function search(keyword) {
  const [results, rate] = await Promise.all([yuyutei.searchCards(keyword), getJpyToTwd()]);
  return { rate, results: results.map(r => ({ ...r, priceTwd: toTwd(r.priceJpy, rate) })) };
}

function withTwd(item, rate) {
  const history = item.history || [];
  const latest = history[history.length - 1];
  // Compare with the last recorded price that differs, so a flat run still shows the latest move
  const previous = [...history].reverse().find(h => latest && h.priceJpy !== latest.priceJpy);
  return {
    ...item,
    priceJpy: latest?.priceJpy ?? null,
    priceTwd: toTwd(latest?.priceJpy, rate),
    stock: latest?.stock ?? null,
    updatedAt: latest?.at ?? null,
    previousJpy: previous?.priceJpy ?? null,
  };
}

async function getWatchlist() {
  const rate = await getJpyToTwd();
  return { rate, items: storage.getWatchlist().map(i => withTwd(i, rate)) };
}

// Add a card found via search; adding one that's already watched just returns it
async function addToWatchlist(card) {
  if (!card?.id || !card?.url) throw new Error('缺少卡片資料');
  const items = storage.getWatchlist();
  let item = items.find(i => i.id === card.id);
  if (!item) {
    item = {
      id: card.id,
      name: card.name,
      cardNumber: card.cardNumber,
      rarity: card.rarity,
      set: card.set,
      url: card.url,
      imageUrl: card.imageUrl,
      addedAt: new Date().toISOString(),
      history: card.priceJpy != null ? [{ at: new Date().toISOString(), priceJpy: card.priceJpy, stock: card.stock }] : [],
    };
    items.push(item);
    storage.saveWatchlist(items);
  }
  return withTwd(item, await getJpyToTwd());
}

function removeFromWatchlist(id) {
  const items = storage.getWatchlist();
  const next = items.filter(i => i.id !== id);
  if (next.length === items.length) return false;
  storage.saveWatchlist(next);
  return true;
}

// Re-fetch every watched card's page, one at a time to stay polite to the shop
async function refreshWatchlist() {
  const items = storage.getWatchlist();
  const errors = [];
  for (const item of items) {
    try {
      const { priceJpy, stock } = await yuyutei.fetchCardPrice(item.url);
      if (priceJpy == null) continue;
      item.history = [...(item.history || []), { at: new Date().toISOString(), priceJpy, stock }].slice(-MAX_HISTORY);
    } catch (e) {
      errors.push(`${item.name}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  // Re-read so cards added or removed during the refresh aren't lost or revived
  const latest = storage.getWatchlist();
  const refreshed = new Map(items.map(i => [i.id, i.history]));
  storage.saveWatchlist(latest.map(i => (refreshed.has(i.id) ? { ...i, history: refreshed.get(i.id) } : i)));
  return { updated: items.length - errors.length, errors };
}

module.exports = { getJpyToTwd, search, getWatchlist, addToWatchlist, removeFromWatchlist, refreshWatchlist };
