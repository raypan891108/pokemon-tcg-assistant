const fs = require('fs');
const path = require('path');

// Each document (products, inventory, settings, ...) is one JSON file in DATA_DIR

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const FILE_NAMES = {
  products: 'products.json',
  events: 'events.json',
  tournaments: 'tournaments.json',
  lastFetch: 'last_fetch.json',
  settings: 'settings.json',
  inventory: 'inventory.json',
  watchlist: 'watchlist.json',
  decks: 'decks.json',
  reminders: 'reminders.json',
  releaseReminders: 'release_reminders.json',
  cardNames: 'card_names.json',
  sources: 'sources.json',
  geocode: 'geocode.json',
  links: 'links.json',
};

// Default settings
const DEFAULT_SETTINGS = {
  discordWebhook: '',
  regions: ['tw', 'jp', 'us'],
  notifyNewProducts: true,
  notifyEvents: true,
  notifyTournaments: true,
  notifyDaysBeforeDeadline: 3,
  notifyDaysBeforeRelease: 3,
  fetchIntervalHours: 1,
  // 卡拍拍 seller fee (%) applied to a sale when no fee is entered
  kapaipaiFeeRate: 0,
  // Fallback when the live JPY→TWD rate can't be fetched
  jpyToTwd: 0.21,
};

// A missing file returns the default; any other failure throws, so a
// read-modify-write never overwrites real data after a failed read.
async function read(doc, defaultValue) {
  const filePath = path.join(DATA_DIR, FILE_NAMES[doc]);
  if (!fs.existsSync(filePath)) return defaultValue;
  return JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
}

// Windows refuses to replace a file another program (antivirus, backup) briefly has open
async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fs.promises.rename(from, to);
    } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || attempt >= 5) throw e;
      await new Promise(resolve => setTimeout(resolve, 50 * attempt));
    }
  }
}

let tmpCounter = 0;

// Written to a temporary file and then swapped in, so a crash or power cut mid-write
// leaves the previous file intact instead of half a JSON document
async function write(doc, value) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, FILE_NAMES[doc]);
  const tmpPath = `${filePath}.${process.pid}-${++tmpCounter}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
    await renameWithRetry(tmpPath, filePath);
  } catch (e) {
    await fs.promises.rm(tmpPath, { force: true });
    throw e;
  }
}

// Merge new items with existing, deduplicated by id
function mergeItems(existing, newItems) {
  const map = new Map(existing.map(item => [item.id, item]));
  const added = [];
  for (const item of newItems) {
    if (!map.has(item.id)) {
      map.set(item.id, { ...item, addedAt: new Date().toISOString() });
      added.push(item);
    } else {
      // Update existing item but preserve addedAt
      map.set(item.id, { ...map.get(item.id), ...item });
    }
  }
  return { items: Array.from(map.values()), added };
}

async function mergeAndSave(doc, newItems) {
  const { items, added } = mergeItems(await read(doc, []), newItems);
  await write(doc, items);
  return added;
}

module.exports = {
  dataDir: DATA_DIR,

  getProducts: () => read('products', []),
  getEvents: () => read('events', []),
  getTournaments: () => read('tournaments', []),
  getInventory: () => read('inventory', []),
  saveInventory: (items) => write('inventory', items),
  getWatchlist: () => read('watchlist', []),
  saveWatchlist: (items) => write('watchlist', items),
  getDecks: () => read('decks', {}),
  saveDecks: (data) => write('decks', data),
  // Deadline reminders already sent: { "<tournament id>|<deadline>": { window, lastDay } }
  getReminders: () => read('reminders', {}),
  saveReminders: (data) => write('reminders', data),
  // Release reminders already sent: { "<product id>|<release date>": { soon, day } }
  getReleaseReminders: () => read('releaseReminders', {}),
  saveReleaseReminders: (data) => write('releaseReminders', data),
  // PokeAPI species list and translated names (see card-names.js)
  getCardNames: () => read('cardNames', {}),
  saveCardNames: (data) => write('cardNames', data),
  getSettings: async () => ({ ...DEFAULT_SETTINGS, ...await read('settings', {}) }),
  saveSettings: (settings) => write('settings', settings),
  getLastFetch: () => read('lastFetch', {}),
  // Health of each scraper source: { "<region>-<kind>": { count, error, lastRunAt, lastSuccessAt, failStreak } }
  getSources: () => read('sources', {}),
  saveSources: (data) => write('sources', data),
  // Map coordinates of tournament venues: { "<city>|<district>|<road>|<number>": { lat, lng, precision, at } }
  getGeocode: () => read('geocode', {}),
  saveGeocode: (data) => write('geocode', data),
  // Your grouped website links (see links.js); null until first saved
  getLinks: () => read('links', null),
  saveLinks: (data) => write('links', data),

  saveProducts: (newItems) => mergeAndSave('products', newItems),
  saveEvents: (newItems) => mergeAndSave('events', newItems),
  saveTournaments: (newItems) => mergeAndSave('tournaments', newItems),

  // Record several fetch timestamps in one write (parallel writes would overwrite each other)
  updateLastFetch: async (keys) => {
    const data = await read('lastFetch', {});
    const now = new Date().toISOString();
    for (const key of keys) data[key] = now;
    await write('lastFetch', data);
  },

  getStats: async () => {
    const [products, events, tournaments] = await Promise.all([
      read('products', []), read('events', []), read('tournaments', []),
    ]);
    const now = new Date();
    // Same rule as the tournaments page's 即將舉辦 filter: not yet held, or date unknown
    const upcoming = tournaments.filter(t => !t.date || new Date(t.date) >= now);
    const openForEntry = tournaments.filter(t => t.deadline && new Date(t.deadline) > now);
    return {
      totalProducts: products.length,
      totalEvents: events.length,
      totalTournaments: tournaments.length,
      upcomingTournaments: upcoming.length,
      openForEntry: openForEntry.length,
      newProducts: products.filter(p => {
        const added = new Date(p.addedAt || p.releaseDate);
        return (now - added) < 7 * 24 * 60 * 60 * 1000;
      }).length,
    };
  },
};
