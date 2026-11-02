import './style.css';
import { api } from './api.js';
import { showToast } from './utils.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderProducts } from './pages/products.js';
import { renderEvents } from './pages/events.js';
import { renderTournaments } from './pages/tournaments.js';
import { renderMarket } from './pages/market.js';
import { renderInventory } from './pages/inventory.js';
import { renderDecks } from './pages/decks.js';
import { renderSettings } from './pages/settings.js';

// ─── State ───────────────────────────────────────────────────
let currentPage = 'dashboard';

const PAGES = {
  dashboard: renderDashboard,
  products: renderProducts,
  events: renderEvents,
  tournaments: renderTournaments,
  market: renderMarket,
  inventory: renderInventory,
  decks: renderDecks,
  settings: renderSettings,
};

// ─── Router ──────────────────────────────────────────────────
export async function navigate(page) {
  if (!PAGES[page]) return;
  currentPage = page;

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Phone widths: show the page name in the top bar and close the menu drawer
  const label = document.querySelector(`.nav-item[data-page="${page}"] .nav-label`);
  if (label) document.getElementById('mobile-title').textContent = label.textContent;
  setMenuOpen(false);

  const main = document.getElementById('main-content');
  await PAGES[page](main);
}

// ─── Mobile menu ─────────────────────────────────────────────
// At phone widths the sidebar sits off-screen; .open slides it in (see style.css)
function setMenuOpen(open) {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menu-toggle');
  sidebar.classList.toggle('open', open);
  document.getElementById('sidebar-backdrop').classList.toggle('visible', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
}

document.getElementById('menu-toggle').addEventListener('click', () => {
  setMenuOpen(!document.getElementById('sidebar').classList.contains('open'));
});
document.getElementById('sidebar-backdrop').addEventListener('click', () => setMenuOpen(false));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') setMenuOpen(false);
});

// ─── Sidebar Navigation ──────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigate(el.dataset.page);
  });
});

// ─── Refresh Button ──────────────────────────────────────────
const btnRefresh = document.getElementById('btn-refresh');
btnRefresh.addEventListener('click', async () => {
  if (btnRefresh.classList.contains('spinning')) return;

  btnRefresh.classList.add('spinning');
  const toast = showToast('正在更新資料...', 'loading', 0);

  try {
    const result = await api.fetch();
    toast.remove();

    if (result.success) {
      const msgs = [];
      if (result.newProducts > 0) msgs.push(`📦 ${result.newProducts} 個新商品`);
      if (result.newEvents > 0) msgs.push(`🎉 ${result.newEvents} 個新活動`);
      if (result.newTournaments > 0) msgs.push(`🏆 ${result.newTournaments} 個新賽事`);
      showToast(msgs.length > 0 ? `更新完成！發現 ${msgs.join('、')}` : '更新完成，目前無新資料', 'success');
    } else {
      showToast(result.reason === 'already_running' ? '資料更新中，請稍候...' : '更新失敗', 'error');
    }

    // Update badges and the last-update time
    await updateBadges();
    await checkUpdates({ quiet: true });

    // Refresh current page
    await navigate(currentPage);
  } catch (e) {
    toast.remove();
    showToast('無法連接後端，請確認服務已啟動', 'error');
  } finally {
    btnRefresh.classList.remove('spinning');
  }
});

// ─── Badges ──────────────────────────────────────────────────
async function updateBadges() {
  try {
    const stats = await api.stats();
    const badgeProducts = document.getElementById('badge-products');
    const badgeEvents = document.getElementById('badge-events');
    const badgeTournaments = document.getElementById('badge-tournaments');

    if (stats.newProducts > 0) {
      badgeProducts.textContent = stats.newProducts;
      badgeProducts.style.display = '';
    } else {
      badgeProducts.style.display = 'none';
    }
    if (stats.totalEvents > 0) {
      badgeEvents.textContent = stats.totalEvents;
      badgeEvents.style.display = '';
    } else {
      badgeEvents.style.display = 'none';
    }
    // Tournaments still taking registrations: the ones you might need to act on
    if (stats.openForEntry > 0) {
      badgeTournaments.textContent = stats.openForEntry;
      badgeTournaments.style.display = '';
    } else {
      badgeTournaments.style.display = 'none';
    }
  } catch (_) {}
}

// ─── Connection Health Check ──────────────────────────────────
async function checkHealth() {
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  try {
    const { build } = await api.health();
    dot.className = 'status-dot';
    text.textContent = '已連線';
    checkBuild(build);
  } catch {
    dot.className = 'status-dot error';
    text.textContent = '後端離線';
  }
}

// ─── New version notice ──────────────────────────────────────
// The built script this page is running (index-<hash>.js); null in dev, where Vite serves sources.
// Navigating inside the app never reloads it, so a page left open keeps running old code.
const runningBuild = (document.querySelector('script[type="module"][src*="/assets/index-"]')
  ?.getAttribute('src') || '').split('/').pop() || null;

function checkBuild(serverBuild) {
  if (!runningBuild || !serverBuild || serverBuild === runningBuild) return;
  if (document.getElementById('update-banner')) return;
  // Not reloaded automatically: the user may be in the middle of typing something
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'update-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `<span>🆕 網站已更新</span><button class="btn-primary btn-sm" type="button">點此重新整理</button>`;
  banner.querySelector('button').addEventListener('click', () => window.location.reload());
  document.body.appendChild(banner);
}

// ─── Hourly update status ────────────────────────────────────
// The backend re-fetches every hour; show when, and pick up new data in an open page
let seenRunAt = null;

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
}

// quiet: after a manual refresh, which already showed its own result
async function checkUpdates({ quiet = false } = {}) {
  const el = document.getElementById('fetch-times');
  try {
    const status = await api.schedulerStatus();
    el.textContent = status.running
      ? '正在抓取最新資料...'
      : `上次更新 ${formatTime(status.lastRunAt)}${status.nextRunAt ? ` · 下次 ${formatTime(status.nextRunAt)}` : ''}`;

    // A fetch finished since we last looked
    if (!quiet && seenRunAt && status.lastRunAt && status.lastRunAt !== seenRunAt && !status.running) {
      const r = status.lastResult || {};
      const found = (r.newProducts || 0) + (r.newEvents || 0) + (r.newTournaments || 0);
      await updateBadges();
      if (found > 0) {
        showToast(`🔄 自動更新發現 ${found} 筆新資料`, 'success', 6000);
        // Re-render only the dashboard, which has no inputs or dialogs to disturb
        if (currentPage === 'dashboard' && !document.querySelector('.modal-backdrop')) await navigate('dashboard');
      }
    }
    if (!status.running) seenRunAt = status.lastRunAt;
  } catch {
    el.textContent = '';
  }
}

// ─── Global navigate access ──────────────────────────────────
window.navigate = navigate;

// ─── Login ───────────────────────────────────────────────────
function showLogin() {
  if (document.getElementById('login-screen')) return;
  const screen = document.createElement('div');
  screen.id = 'login-screen';
  screen.className = 'modal-backdrop';
  screen.style.alignItems = 'center';
  screen.style.background = 'var(--bg-primary)';
  screen.innerHTML = `
    <form class="modal" id="login-form" style="max-width:360px">
      <div class="modal-title">🎴 TCG 助手登入</div>
      <div class="form-group">
        <label class="form-label" for="login-password">密碼</label>
        <input type="password" id="login-password" class="form-input" autocomplete="current-password" required />
      </div>
      <div class="form-error" id="login-error"></div>
      <button class="btn-primary" type="submit" style="width:100%;padding:10px">登入</button>
    </form>`;
  document.body.appendChild(screen);
  screen.querySelector('#login-password').focus();

  screen.querySelector('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.login(screen.querySelector('#login-password').value);
      window.location.reload();
    } catch (err) {
      screen.querySelector('#login-error').textContent = err.message;
    }
  });
}

window.addEventListener('auth-required', showLogin);

// ─── Init ────────────────────────────────────────────────────
(async () => {
  try {
    const { required, authenticated } = await api.authStatus();
    if (required && !authenticated) {
      showLogin();
      return;
    }
  } catch {
    // Backend unreachable — fall through and let the health check show it
  }

  // Check backend connection
  await checkHealth();

  // Load initial badges
  await updateBadges();

  // Render default page
  await navigate('dashboard');

  await checkUpdates();

  // Periodic health and update check
  setInterval(() => { checkHealth(); checkUpdates(); }, 30000);

  // Phones pause timers in background tabs: check right away when the page is shown again
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkHealth();
      checkUpdates();
    }
  });
})();
