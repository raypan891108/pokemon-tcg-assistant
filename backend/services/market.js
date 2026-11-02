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
  return Number((await storage.getSettings()).jpyToTwd) || 0.21;
}

function toTwd(jpy, rate) {
  return jpy != null ? Math.round(jpy * rate) : null;
}

async function search(keyword) {
  const [results, rate] = await Promise.all([yuyutei.searchCards(keyword), getJpyToTwd()]);
  return { rate, results: results.map(r => ({ ...r, priceTwd: toTwd(r.priceJpy, rate) })) };
}

function lastEntry(item) {
  const history = item.history || [];
  return history[history.length - 1];
}

function withTwd(item, rate) {
  const history = item.history || [];
  const latest = lastEntry(item);
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
  const [rate, items] = await Promise.all([getJpyToTwd(), storage.getWatchlist()]);
  return { rate, items: items.map(i => withTwd(i, rate)) };
}

// Add a card found via search; adding one that's already watched just returns it
async function addToWatchlist(card) {
  if (!card?.id || !card?.url) throw new Error('缺少卡片資料');
  const items = await storage.getWatchlist();
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
    await storage.saveWatchlist(items);
  }
  return withTwd(item, await getJpyToTwd());
}

async function removeFromWatchlist(id) {
  const items = await storage.getWatchlist();
  const next = items.filter(i => i.id !== id);
  if (next.length === items.length) return false;
  await storage.saveWatchlist(next);
  return true;
}

// Re-fetch watched cards' pages one at a time to stay polite to the shop.
// Stalest cards go first, and the loop stops at `deadline` so a serverless run
// finishes in time; the rest are picked up on the next run.
async function refreshWatchlist({ deadline = Infinity } = {}) {
  const items = await storage.getWatchlist();
  const queue = [...items].sort((a, b) => (lastEntry(a)?.at || '').localeCompare(lastEntry(b)?.at || ''));
  const refreshed = new Map();
  const errors = [];
  let processed = 0;

  for (const item of queue) {
    if (Date.now() > deadline) break;
    processed++;
    try {
      const { priceJpy, stock } = await yuyutei.fetchCardPrice(item.url);
      if (priceJpy != null) {
        refreshed.set(item.id, [...(item.history || []), { at: new Date().toISOString(), priceJpy, stock }].slice(-MAX_HISTORY));
      }
    } catch (e) {
      errors.push(`${item.name}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Re-read so cards added or removed during the refresh aren't lost or revived
  if (refreshed.size) {
    const latest = await storage.getWatchlist();
    await storage.saveWatchlist(latest.map(i => (refreshed.has(i.id) ? { ...i, history: refreshed.get(i.id) } : i)));
  }
  return { updated: refreshed.size, errors, skipped: queue.length - processed };
}

module.exports = { getJpyToTwd, search, getWatchlist, addToWatchlist, removeFromWatchlist, refreshWatchlist };
