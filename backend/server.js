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

const app = express();
const PORT = Number(process.env.PORT) || 3001;
// Built frontend; in development Vite serves it instead and proxies /api here
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');

// Behind a reverse proxy (Caddy) req.ip and req.secure come from X-Forwarded-* headers
app.set('trust proxy', 'loopback, uniquelocal');
app.use(express.json());

// ─── Public routes ───────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/auth/status', auth.status);
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);

// ─── API Routes (login required when APP_PASSWORD is set) ────

app.use('/api', auth.requireAuth);

// Stats
app.get('/api/stats', (req, res) => {
  res.json(storage.getStats());
});

// Products
app.get('/api/products', (req, res) => {
  const { region, type, search } = req.query;
  let products = storage.getProducts();
  if (region) products = products.filter(p => p.region === region);
  if (type) products = products.filter(p => p.type === type);
  if (search) {
    const q = search.toLowerCase();
    products = products.filter(p => p.name.toLowerCase().includes(q));
  }
  products.sort((a, b) => new Date(b.releaseDate || b.addedAt || 0) - new Date(a.releaseDate || a.addedAt || 0));
  res.json(products);
});

// Events
app.get('/api/events', (req, res) => {
  const { region, search } = req.query;
  let events = storage.getEvents();
  if (region) events = events.filter(e => e.region === region);
  if (search) {
    const q = search.toLowerCase();
    events = events.filter(e => e.name.toLowerCase().includes(q) || (e.location || '').toLowerCase().includes(q));
  }
  events.sort((a, b) => new Date(a.date || '9999') - new Date(b.date || '9999'));
  res.json(events);
});

// Tournaments
app.get('/api/tournaments', (req, res) => {
  const { region, upcoming } = req.query;
  let tournaments = storage.getTournaments();
  if (region) tournaments = tournaments.filter(t => t.region === region);
  if (upcoming === 'true') {
    const now = new Date();
    tournaments = tournaments.filter(t => !t.date || new Date(t.date) >= now);
  }
  tournaments.sort((a, b) => new Date(a.date || '9999') - new Date(b.date || '9999'));
  res.json(tournaments);
});

// Route helper: turn thrown errors into a 400 with the message
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// Inventory (卡拍拍 賣場倉庫)
app.get('/api/inventory', (req, res) => {
  res.json(inventory.list());
});

app.post('/api/inventory', handle(req => inventory.create(req.body)));

app.put('/api/inventory/:id', handle((req, res) => {
  const item = inventory.update(req.params.id, req.body);
  if (!item) res.status(404);
  return item || { error: '找不到這筆庫存' };
}));

app.post('/api/inventory/:id/sell', handle((req, res) => {
  const item = inventory.sell(req.params.id, req.body);
  if (!item) res.status(404);
  return item || { error: '找不到這筆庫存' };
}));

app.delete('/api/inventory/:id', (req, res) => {
  const ok = inventory.remove(req.params.id);
  res.status(ok ? 200 : 404).json({ success: ok });
});

// Card market (遊々亭)
app.get('/api/market/search', handle(req => {
  const q = (req.query.q || '').trim();
  if (!q) throw new Error('請輸入搜尋關鍵字');
  return market.search(q);
}));

app.get('/api/market/watchlist', handle(() => market.getWatchlist()));

app.post('/api/market/watchlist', handle(req => market.addToWatchlist(req.body)));

app.delete('/api/market/watchlist/:id', (req, res) => {
  const ok = market.removeFromWatchlist(req.params.id);
  res.status(ok ? 200 : 404).json({ success: ok });
});

app.post('/api/market/refresh', handle(() => market.refreshWatchlist()));

// Deck recommendations (Limitless meta)
app.get('/api/decks', handle(req => decks.getMeta(req.query.format, req.query.refresh === 'true')));

app.get('/api/decks/:id/list', handle(req => decks.getSampleList(req.params.id, req.query.format)));

// Settings
app.get('/api/settings', (req, res) => {
  res.json(storage.getSettings());
});

app.post('/api/settings', (req, res) => {
  const settings = storage.getSettings();
  const updated = { ...settings, ...req.body };
  storage.saveSettings(updated);
  res.json({ success: true, settings: updated });
});

// Manual fetch trigger
app.post('/api/fetch', async (req, res) => {
  const result = await scheduler.fetchAll();
  res.json(result);
});

// Scheduler status
app.get('/api/scheduler/status', (req, res) => {
  res.json(scheduler.getStatus());
});

// Test notification
app.post('/api/notify/test', async (req, res) => {
  const success = await notifier.sendTestNotification();
  res.json({ success });
});

// ─── Frontend ────────────────────────────────────────────────
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
}

// ─── Start Server ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎴 Pokemon TCG 助手後端已啟動！`);
  console.log(`📡 API: http://localhost:${PORT}/api/health`);
  console.log(auth.enabled() ? '🔒 已啟用密碼登入\n' : '⚠️  未設定 APP_PASSWORD，任何人都能存取（僅適合本機使用）\n');
  scheduler.start();
});

module.exports = app;
