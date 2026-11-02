const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('./services/auth');
const storage = require('./services/storage');
const scheduler = require('./services/scheduler');
const notifier = require('./services/notifier');
const inventory = require('./services/inventory');
const market = require('./services/market');
const decks = require('./services/decks');

// The Express app, shared by the long-running server (server.js) and the Vercel function (api/index.js)
const app = express();
// Built frontend; in development Vite serves it instead and proxies /api here
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');

// req.ip and req.secure come from X-Forwarded-* headers set by Vercel's edge or a local proxy
app.set('trust proxy', process.env.VERCEL ? true : 'loopback, uniquelocal');
app.use(express.json());

// Route helper: async-safe, turns thrown errors into a JSON error response
const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (!res.headersSent) res.json(result);
  } catch (e) {
    console.error(`[API] ${req.method} ${req.path}:`, e.message);
    if (!res.headersSent) res.status(400).json({ error: e.message });
  }
};

const notFound = (res, message) => {
  res.status(404);
  return { error: message };
};

// ─── Public routes ───────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', storage: storage.driverName, timestamp: new Date().toISOString() });
});

app.get('/api/auth/status', auth.status);
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);

// Scheduled data fetch: Vercel Cron and Supabase pg_cron call this with CRON_SECRET
app.get('/api/cron/fetch', handle((req, res) => {
  if (!auth.hasCronSecret(req)) {
    res.status(401);
    return { error: 'unauthorized' };
  }
  return scheduler.fetchAll();
}));

// ─── API Routes (login required when APP_PASSWORD is set) ────

app.use('/api', auth.requireAuth);

// Stats
app.get('/api/stats', handle(() => storage.getStats()));

// Products
app.get('/api/products', handle(async req => {
  const { region, type, search } = req.query;
  let products = await storage.getProducts();
  if (region) products = products.filter(p => p.region === region);
  if (type) products = products.filter(p => p.type === type);
  if (search) {
    const q = search.toLowerCase();
    products = products.filter(p => p.name.toLowerCase().includes(q));
  }
  products.sort((a, b) => new Date(b.releaseDate || b.addedAt || 0) - new Date(a.releaseDate || a.addedAt || 0));
  return products;
}));

// Events
app.get('/api/events', handle(async req => {
  const { region, search } = req.query;
  let events = await storage.getEvents();
  if (region) events = events.filter(e => e.region === region);
  if (search) {
    const q = search.toLowerCase();
    events = events.filter(e => e.name.toLowerCase().includes(q) || (e.location || '').toLowerCase().includes(q));
  }
  events.sort((a, b) => new Date(a.date || '9999') - new Date(b.date || '9999'));
  return events;
}));

// Tournaments
app.get('/api/tournaments', handle(async req => {
  const { region, upcoming } = req.query;
  let tournaments = await storage.getTournaments();
  if (region) tournaments = tournaments.filter(t => t.region === region);
  if (upcoming === 'true') {
    const now = new Date();
    tournaments = tournaments.filter(t => !t.date || new Date(t.date) >= now);
  }
  tournaments.sort((a, b) => new Date(a.date || '9999') - new Date(b.date || '9999'));
  return tournaments;
}));

// Inventory (卡拍拍 賣場倉庫)
app.get('/api/inventory', handle(() => inventory.list()));

app.post('/api/inventory', handle(req => inventory.create(req.body)));

app.put('/api/inventory/:id', handle(async (req, res) => {
  return await inventory.update(req.params.id, req.body) || notFound(res, '找不到這筆庫存');
}));

app.post('/api/inventory/:id/sell', handle(async (req, res) => {
  return await inventory.sell(req.params.id, req.body) || notFound(res, '找不到這筆庫存');
}));

app.delete('/api/inventory/:id', handle(async (req, res) => {
  const ok = await inventory.remove(req.params.id);
  if (!ok) res.status(404);
  return { success: ok };
}));

// Card market (遊々亭)
app.get('/api/market/search', handle(req => {
  const q = (req.query.q || '').trim();
  if (!q) throw new Error('請輸入搜尋關鍵字');
  return market.search(q);
}));

app.get('/api/market/watchlist', handle(() => market.getWatchlist()));

app.post('/api/market/watchlist', handle(req => market.addToWatchlist(req.body)));

app.delete('/api/market/watchlist/:id', handle(async (req, res) => {
  const ok = await market.removeFromWatchlist(req.params.id);
  if (!ok) res.status(404);
  return { success: ok };
}));

app.post('/api/market/refresh', handle(() => market.refreshWatchlist({
  deadline: process.env.VERCEL ? Date.now() + 50000 : Infinity,
})));

// Deck recommendations (Limitless meta)
app.get('/api/decks', handle(req => decks.getMeta(req.query.format, req.query.refresh === 'true')));

app.get('/api/decks/:id/list', handle(req => decks.getSampleList(req.params.id, req.query.format)));

// Settings
app.get('/api/settings', handle(() => storage.getSettings()));

app.post('/api/settings', handle(async req => {
  const updated = { ...await storage.getSettings(), ...req.body };
  await storage.saveSettings(updated);
  return { success: true, settings: updated };
}));

// Manual fetch trigger
app.post('/api/fetch', handle(() => scheduler.fetchAll()));

// Scheduler status
app.get('/api/scheduler/status', handle(() => scheduler.getStatus()));

// Test notification
app.post('/api/notify/test', handle(async () => ({ success: await notifier.sendTestNotification() })));

// ─── Frontend ────────────────────────────────────────────────
// On Vercel the built frontend is served from the CDN instead
if (!process.env.VERCEL && fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
}

module.exports = app;
