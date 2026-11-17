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

// A photo or video for a warehouse item, sent as the raw file so large videos stream to disk.
// XMLHttpRequest rather than fetch, for upload progress: onProgress(0..1).
function uploadMedia(id, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/inventory/${id}/media`);
    // Windows gives HEIC/MOV files no type; the server then goes by the file name
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401) window.dispatchEvent(new Event('auth-required'));
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `上傳失敗（${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error('上傳失敗，請檢查網路連線'));
    xhr.send(file);
  });
}

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

  rate: (currency) => get(`/rates/${currency}`),
  inventory: (channel) => get('/inventory', { channel }),
  addInventory: (item) => post('/inventory', item),
  updateInventory: (id, item) => put(`/inventory/${id}`, item),
  sellInventory: (id, sale) => post(`/inventory/${id}/sell`, sale),
  deleteInventory: (id) => del(`/inventory/${id}`),
  uploadMedia,
  deleteMedia: (id, mediaId) => del(`/inventory/${id}/media/${mediaId}`),

  marketSearch: (q) => get('/market/search', { q }),
  watchlist: () => get('/market/watchlist'),
  addWatch: (card) => post('/market/watchlist', card),
  removeWatch: (id) => del(`/market/watchlist/${encodeURIComponent(id)}`),
  setWatchAlerts: (id, alerts) => put(`/market/watchlist/${encodeURIComponent(id)}/alerts`, alerts),
  refreshMarket: () => post('/market/refresh'),

  decks: (format, refresh) => get('/decks', { format, refresh }),
  deckList: (id, format) => get(`/decks/${id}/list`, { format }),

  myDecks: () => get('/my-decks'),
  createMyDeck: (deck) => post('/my-decks', deck),
  importMyDeck: (code, name) => post('/my-decks/import', { code, name }),
  saveMyDeck: (id, deck) => put(`/my-decks/${encodeURIComponent(id)}`, deck),
  deleteMyDeck: (id) => del(`/my-decks/${encodeURIComponent(id)}`),

  links: () => get('/links'),
  saveLinks: (data) => put('/links', data),
};
