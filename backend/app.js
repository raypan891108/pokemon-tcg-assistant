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
const backup = require('./services/backup');
const calendar = require('./services/calendar');
const geocode = require('./services/geocode');

// The Express app; server.js starts it
const app = express();
// Built frontend; in development Vite serves it instead and proxies /api here
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');

// Behind `tailscale serve` (a proxy on this machine) req.ip and req.secure come from X-Forwarded-* headers
app.set('trust proxy', 'loopback');
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

// Name of the built main script (index-<hash>.js): it changes whenever the frontend code does,
// so open pages can tell they're running an older version. Read per request because
// `autostart.sh restart` rebuilds the files while this process keeps running.
function currentBuild() {
  try {
    const html = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf8');
    return (html.match(/\/assets\/(index-[\w-]+\.js)/) || [])[1] || null;
  } catch {
    return null;
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', build: currentBuild(), timestamp: new Date().toISOString() });
});

app.get('/api/auth/status', auth.status);
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);

// Calendar feed for phone calendars, which can't log in; with a password set the URL carries a token
app.get('/api/calendar.ics', handle(async (req, res) => {
  if (!auth.hasCalendarAccess(req)) {
    res.status(401);
    return { error: 'unauthorized' };
  }
  res.type('text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="pokemon-tcg.ics"');
  res.send(await calendar.buildCalendar());
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
  // Map coordinates of venues located so far (Taiwan only)
  return geocode.attach(tournaments);
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

app.put('/api/market/watchlist/:id/alerts', handle(async (req, res) => {
  return await market.setAlerts(req.params.id, req.body) || notFound(res, '找不到這張追蹤的卡');
}));

app.post('/api/market/refresh', handle(() => market.refreshWatchlist()));

// Deck recommendations (Limitless meta)
app.get('/api/decks', handle(req => decks.getMeta(req.query.format, req.query.refresh === 'true')));

app.get('/api/decks/:id/list', handle(req => decks.getSampleList(req.params.id, req.query.format)));

// Subscription path for the settings page (includes the token when a password is set)
app.get('/api/calendar/info', handle(() => {
  const token = auth.calendarToken();
  return { path: `/api/calendar.ics${token ? `?token=${token}` : ''}` };
}));

// Backups of your own records
app.get('/api/backup', handle(() => backup.getStatus()));

app.post('/api/backup', handle(() => backup.backupNow()));

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
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST, {
    setHeaders(res, filePath) {
      // Hashed assets never change under the same name; the page must always be revalidated
      res.setHeader('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache');
    },
  }));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

module.exports = app;
