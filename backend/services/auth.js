const crypto = require('crypto');

// Login is enabled only when APP_PASSWORD is set, so local development needs no password
const PASSWORD = process.env.APP_PASSWORD || '';
// Signs session cookies. Without SESSION_SECRET it is derived from the password, so logins
// survive restarts and changing the password logs everyone out.
const SECRET = process.env.SESSION_SECRET
  || crypto.createHash('sha256').update(`tcg-session:${PASSWORD}`).digest('hex');
const COOKIE = 'tcg_session';
const SESSION_DAYS = 30;

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

const enabled = () => PASSWORD.length > 0;

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  const match = header.split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
}

// Token is "<expiry ms>.<hmac>"
function isAuthenticated(req) {
  if (!enabled()) return true;
  const token = readCookie(req);
  if (!token) return false;
  const [expires, mac] = token.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  return safeEqual(mac, sign(expires));
}

function setSession(req, res) {
  const expires = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const parts = [
    `${COOKIE}=${encodeURIComponent(`${expires}.${sign(expires)}`)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter(t => now - t < WINDOW_MS);
  attempts.set(ip, recent);
  return recent.length >= MAX_ATTEMPTS;
}

function login(req, res) {
  if (!enabled()) return res.json({ success: true });
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: '嘗試次數過多，請 15 分鐘後再試' });
  }
  const password = String(req.body?.password || '');
  if (!safeEqual(sign(password), sign(PASSWORD))) {
    attempts.get(ip).push(Date.now());
    return res.status(401).json({ error: '密碼錯誤' });
  }
  attempts.delete(ip);
  setSession(req, res);
  res.json({ success: true });
}

function logout(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ success: true });
}

function status(req, res) {
  res.json({ required: enabled(), authenticated: isAuthenticated(req) });
}

// Guards every /api route except health and the auth endpoints themselves
function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: '請先登入' });
}

// Phone calendars can't log in, so with a password set the calendar URL carries this token.
// It's derived from the session secret, so changing the password changes the URL too.
function calendarToken() {
  return enabled() ? sign('calendar-feed').slice(0, 32) : null;
}

function hasCalendarAccess(req) {
  if (!enabled()) return true;
  return safeEqual(String(req.query.token || ''), calendarToken());
}

module.exports = { enabled, login, logout, status, requireAuth, calendarToken, hasCalendarAccess };
