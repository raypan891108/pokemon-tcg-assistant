const fs = require('fs');
const path = require('path');

// Each document (products, inventory, settings, ...) is one JSON value.
// Locally they are files in DATA_DIR; when SUPABASE_URL is set (e.g. on Vercel)
// they are rows in a Supabase table, since serverless functions can't keep files.

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

// A missing document returns the default; any other failure throws, so a
// read-modify-write never overwrites real data after a failed read.
const fileDriver = {
  name: 'file',
  async read(doc, defaultValue) {
    const filePath = path.join(DATA_DIR, FILE_NAMES[doc]);
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
  },
  async write(doc, value) {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(DATA_DIR, FILE_NAMES[doc]), JSON.stringify(value, null, 2), 'utf-8');
  },
};

// Talks to Supabase's REST API (PostgREST) directly; table schema is in supabase/schema.sql
function supabaseDriver(url, key, table) {
  const base = `${url.replace(/\/$/, '')}/rest/v1/${table}`;
  // New "sb_secret_..." keys go in the apikey header only; legacy service_role JWTs also as Bearer
  const headers = {
    apikey: key,
    ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
  };

  async function request(urlPath, options = {}) {
    const res = await fetch(`${base}${urlPath}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  return {
    name: 'supabase',
    async read(doc, defaultValue) {
      const res = await request(`?key=eq.${encodeURIComponent(doc)}&select=value`);
      const rows = await res.json();
      return rows.length ? rows[0].value : defaultValue;
    },
    async write(doc, value) {
      await request('?on_conflict=key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ key: doc, value, updated_at: new Date().toISOString() }]),
      });
    },
  };
}

const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const driver = process.env.SUPABASE_URL && SUPABASE_KEY
  ? supabaseDriver(process.env.SUPABASE_URL, SUPABASE_KEY, process.env.SUPABASE_TABLE || 'tcg_store')
  : fileDriver;

const read = (doc, defaultValue) => driver.read(doc, defaultValue);
const write = (doc, value) => driver.write(doc, value);

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
  driverName: driver.name,
  fileDriver,
  read,
  write,

  getProducts: () => read('products', []),
  getEvents: () => read('events', []),
  getTournaments: () => read('tournaments', []),
  getInventory: () => read('inventory', []),
  saveInventory: (items) => write('inventory', items),
  getWatchlist: () => read('watchlist', []),
  saveWatchlist: (items) => write('watchlist', items),
  getDecks: () => read('decks', {}),
  saveDecks: (data) => write('decks', data),
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
