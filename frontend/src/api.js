// Same origin as the page: the backend serves the built frontend, and Vite proxies /api in development
const API = '/api';

// Surface the backend's { error } message when a request fails
async function request(url, options) {
  const res = await fetch(url, options);
  // Session expired or missing — send the user back to the login screen
  if (res.status === 401 && !String(url).includes('/auth/')) {
    window.dispatchEvent(new Event('auth-required'));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

export async function get(endpoint, params = {}) {
  const url = new URL(`${API}${endpoint}`, window.location.origin);
  Object.entries(params).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
  return request(url);
}

function send(method) {
  return (endpoint, body = {}) => request(`${API}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const post = send('POST');
export const put = send('PUT');
export const del = (endpoint) => request(`${API}${endpoint}`, { method: 'DELETE' });

export const api = {
  stats: () => get('/stats'),
  products: (params) => get('/products', params),
  events: (params) => get('/events', params),
  tournaments: (params) => get('/tournaments', params),
  settings: () => get('/settings'),
  saveSettings: (s) => post('/settings', s),
  fetch: () => post('/fetch'),
  schedulerStatus: () => get('/scheduler/status'),
  calendarInfo: () => get('/calendar/info'),
  backupStatus: () => get('/backup'),
  backupNow: () => post('/backup'),
  testNotify: () => post('/notify/test'),
  health: () => get('/health'),
  authStatus: () => get('/auth/status'),
  login: (password) => post('/auth/login', { password }),
  logout: () => post('/auth/logout'),

  inventory: () => get('/inventory'),
  addInventory: (item) => post('/inventory', item),
  updateInventory: (id, item) => put(`/inventory/${id}`, item),
  sellInventory: (id, sale) => post(`/inventory/${id}/sell`, sale),
  deleteInventory: (id) => del(`/inventory/${id}`),

  marketSearch: (q) => get('/market/search', { q }),
  watchlist: () => get('/market/watchlist'),
  addWatch: (card) => post('/market/watchlist', card),
  removeWatch: (id) => del(`/market/watchlist/${encodeURIComponent(id)}`),
  setWatchAlerts: (id, alerts) => put(`/market/watchlist/${encodeURIComponent(id)}/alerts`, alerts),
  refreshMarket: () => post('/market/refresh'),

  decks: (format, refresh) => get('/decks', { format, refresh }),
  deckList: (id, format) => get(`/decks/${id}/list`, { format }),
};
