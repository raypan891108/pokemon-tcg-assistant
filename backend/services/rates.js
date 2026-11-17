const axios = require('axios');
const storage = require('./storage');

// Exchange rates to NT$ from a free FX API (open.er-api.com, which itself updates once a day).
// A rate is kept for 6 hours; the CNY rate is also refreshed on every hourly fetch (see
// scheduler.js). If the API can't be reached, the last rate it gave is used, and before
// there is one, the backup rate in 設定.

const TTL_MS = 6 * 60 * 60 * 1000;
// Currency → its backup rate in settings
const FALLBACK_SETTING = { JPY: 'jpyToTwd', CNY: 'cnyToTwd' };
const cache = new Map();

function check(currency) {
  if (!FALLBACK_SETTING[currency]) throw new Error('不支援的幣別');
}

// Fetch now, whatever is cached; returns null if the API can't be reached
async function fetchRate(currency) {
  try {
    const { data } = await axios.get(`https://open.er-api.com/v6/latest/${currency}`, { timeout: 10000 });
    const rate = data?.rates?.TWD;
    if (!rate) return null;
    const result = { currency, rate, live: true, at: new Date().toISOString(), sourceUpdatedAt: data.time_last_update_utc || null };
    cache.set(currency, { result, fetchedAt: Date.now() });
    return result;
  } catch (e) {
    console.error(`[Rates] ${currency}:`, e.message);
    return null;
  }
}

// { currency, rate, live, at, sourceUpdatedAt }: live is false when the backup rate from 設定 was used
async function getRate(currency) {
  check(currency);
  const cached = cache.get(currency);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.result;
  const fresh = await fetchRate(currency);
  if (fresh) return fresh;
  if (cached) return cached.result;
  const settings = await storage.getSettings();
  return { currency, rate: Number(settings[FALLBACK_SETTING[currency]]) || 0, live: false, at: null, sourceUpdatedAt: null };
}

// Re-fetch now (the hourly fetch calls this); keeps the previous rate if the API is down
async function refresh(currency) {
  check(currency);
  return fetchRate(currency);
}

module.exports = { getRate, refresh };
