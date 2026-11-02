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

  const main = document.getElementById('main-content');
  await PAGES[page](main);
}

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

    // Update badges
    await updateBadges();

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
    if (stats.upcomingTournaments > 0) {
      badgeTournaments.textContent = stats.upcomingTournaments;
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
    await api.health();
    dot.className = 'status-dot';
    text.textContent = '已連線';
  } catch {
    dot.className = 'status-dot error';
    text.textContent = '後端離線';
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

  // Periodic health check
  setInterval(checkHealth, 30000);
})();
