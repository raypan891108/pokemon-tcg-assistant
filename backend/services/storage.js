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
};

// Default settings
const DEFAULT_SETTINGS = {
  discordWebhook: '',
  regions: ['tw', 'jp', 'us'],
  notifyNewProducts: true,
  notifyEvents: true,
  notifyTournaments: true,
  notifyDaysBeforeDeadline: 3,
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

async function write(doc, value) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(DATA_DIR, FILE_NAMES[doc]), JSON.stringify(value, null, 2), 'utf-8');
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
  getSettings: async () => ({ ...DEFAULT_SETTINGS, ...await read('settings', {}) }),
  saveSettings: (settings) => write('settings', settings),
  getLastFetch: () => read('lastFetch', {}),

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
    const upcoming = tournaments.filter(t => {
      if (!t.deadline) return false;
      return new Date(t.deadline) > now;
    });
    return {
      totalProducts: products.length,
      totalEvents: events.length,
      totalTournaments: tournaments.length,
      upcomingTournaments: upcoming.length,
      newProducts: products.filter(p => {
        const added = new Date(p.addedAt || p.releaseDate);
        return (now - added) < 7 * 24 * 60 * 60 * 1000;
      }).length,
    };
  },
};
