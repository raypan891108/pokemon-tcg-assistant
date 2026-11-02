const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const FILES = {
  products: path.join(DATA_DIR, 'products.json'),
  events: path.join(DATA_DIR, 'events.json'),
  tournaments: path.join(DATA_DIR, 'tournaments.json'),
  lastFetch: path.join(DATA_DIR, 'last_fetch.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  inventory: path.join(DATA_DIR, 'inventory.json'),
  watchlist: path.join(DATA_DIR, 'watchlist.json'),
  decks: path.join(DATA_DIR, 'decks.json'),
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to read ${filePath}:`, e.message);
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error(`Failed to write ${filePath}:`, e.message);
    return false;
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

module.exports = {
  getProducts: () => readJSON(FILES.products),
  getEvents: () => readJSON(FILES.events),
  getTournaments: () => readJSON(FILES.tournaments),
  getInventory: () => readJSON(FILES.inventory),
  saveInventory: (items) => writeJSON(FILES.inventory, items),
  getWatchlist: () => readJSON(FILES.watchlist),
  saveWatchlist: (items) => writeJSON(FILES.watchlist, items),
  getDecks: () => readJSON(FILES.decks, {}),
  saveDecks: (data) => writeJSON(FILES.decks, data),
  getSettings: () => ({ ...DEFAULT_SETTINGS, ...readJSON(FILES.settings, {}) }),
  getLastFetch: () => readJSON(FILES.lastFetch, {}),

  saveSettings: (settings) => writeJSON(FILES.settings, settings),

  saveProducts: (newItems) => {
    const existing = readJSON(FILES.products);
    const { items, added } = mergeItems(existing, newItems);
    writeJSON(FILES.products, items);
    return added;
  },

  saveEvents: (newItems) => {
    const existing = readJSON(FILES.events);
    const { items, added } = mergeItems(existing, newItems);
    writeJSON(FILES.events, items);
    return added;
  },

  saveTournaments: (newItems) => {
    const existing = readJSON(FILES.tournaments);
    const { items, added } = mergeItems(existing, newItems);
    writeJSON(FILES.tournaments, items);
    return added;
  },

  updateLastFetch: (region) => {
    const data = readJSON(FILES.lastFetch, {});
    data[region] = new Date().toISOString();
    writeJSON(FILES.lastFetch, data);
  },

  getStats: () => {
    const products = readJSON(FILES.products);
    const events = readJSON(FILES.events);
    const tournaments = readJSON(FILES.tournaments);
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
  }
};
