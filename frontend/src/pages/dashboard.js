import { api } from '../api.js';
import { formatDate, daysUntil, deadlineClass, deadlineText, regionLabel, escHtml, startCountdown } from '../utils.js';
import { navigate } from '../main.js';

let countdownIntervals = [];

export async function renderDashboard(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">🎴 儀表板</h1>
        <p class="page-subtitle">Pokemon TCG 資訊總覽</p>
      </div>
    </div>
    <div class="page-body">
      <div id="stats-container"><div class="loading-spinner"><div class="spinner"></div><span>載入中...</span></div></div>
      <div class="dashboard-cols" id="dashboard-cols" style="display:none">
        <div>
          <div class="section-title">最新消息</div>
          <div id="timeline-container"></div>
        </div>
        <div>
          <div class="section-title">即將截止報名</div>
          <div id="urgency-container"></div>
        </div>
      </div>
    </div>`;

  try {
    const [stats, products, events, tournaments] = await Promise.all([
      api.stats(),
      api.products(),
      api.events(),
      api.tournaments({ upcoming: 'true' }),
    ]);

    renderStats(stats, products);
    renderTimeline(products, events, tournaments);
    renderUrgency(tournaments);

    document.getElementById('dashboard-cols').style.display = 'grid';
  } catch (e) {
    document.getElementById('stats-container').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">無法連線到後端伺服器</div>
        <div class="empty-desc">請確認後端服務已啟動（port 3001）</div>
      </div>`;
  }
}

function renderStats(stats, products) {
  const newProducts = products.filter(p => {
    const d = new Date(p.addedAt || p.releaseDate || 0);
    return (Date.now() - d) < 7 * 24 * 60 * 60 * 1000;
  });

  document.getElementById('stats-container').innerHTML = `
    <div class="stats-grid" style="margin-bottom:32px">
      <div class="stat-card" onclick="navigate('products')">
        <div class="stat-icon">📦</div>
        <div class="stat-value">${stats.totalProducts || 0}</div>
        <div class="stat-label">追蹤商品</div>
        <div class="stat-sub">近 7 天新增 ${newProducts.length} 件</div>
      </div>
      <div class="stat-card" onclick="navigate('events')">
        <div class="stat-icon">🎉</div>
        <div class="stat-value">${stats.totalEvents || 0}</div>
        <div class="stat-label">活動資訊</div>
        <div class="stat-sub">多國整合</div>
      </div>
      <div class="stat-card" onclick="navigate('tournaments')">
        <div class="stat-icon">🏆</div>
        <div class="stat-value">${stats.upcomingTournaments || 0}</div>
        <div class="stat-label">即將舉辦</div>
        <div class="stat-sub">${stats.openForEntry || 0} 場開放報名中</div>
      </div>
      <div class="stat-card" onclick="navigate('market')">
        <div class="stat-icon">💹</div>
        <div class="stat-value">即時</div>
        <div class="stat-label">市場卡價</div>
        <div class="stat-sub">遊々亭 日本行情</div>
      </div>
    </div>`;
}

function renderTimeline(products, events, tournaments) {
  // Combine and sort by date added or release
  const items = [
    ...products.slice(0, 5).map(p => ({ ...p, _type: 'product', _sortDate: p.addedAt || p.releaseDate })),
    ...events.slice(0, 5).map(e => ({ ...e, _type: 'event', _sortDate: e.addedAt || e.date })),
    ...tournaments.slice(0, 5).map(t => ({ ...t, _type: 'tournament', _sortDate: t.addedAt || t.date })),
  ].sort((a, b) => new Date(b._sortDate || 0) - new Date(a._sortDate || 0)).slice(0, 10);

  if (items.length === 0) {
    document.getElementById('timeline-container').innerHTML = `
      <div class="empty-state" style="padding:40px 0">
        <div class="empty-icon">📭</div>
        <div class="empty-title">尚無資料</div>
        <div class="empty-desc">點擊「立即更新」按鈕抓取最新資料</div>
      </div>`;
    return;
  }

  const typeIcons = { product: '📦', event: '🎉', tournament: '🏆' };
  const typeLabels = { product: '新商品', event: '活動', tournament: '比賽' };

  document.getElementById('timeline-container').innerHTML = `
    <div class="panel">
      <div class="timeline">
        ${items.map((item, i) => `
          <div class="timeline-item" style="animation-delay:${i * 0.05}s">
            <div class="timeline-dot ${i < 3 ? 'new' : ''}"></div>
            <div class="timeline-content">
              <div class="timeline-title">${typeIcons[item._type]} ${escHtml(item.name)}</div>
              <div class="timeline-meta">
                <span>${typeLabels[item._type]}</span>
                <span>${regionLabel(item.region)}</span>
                ${item.date || item.releaseDate ? `<span>📅 ${formatDate(item.date || item.releaseDate)}</span>` : ''}
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderUrgency(tournaments) {
  countdownIntervals.forEach(clearInterval);
  countdownIntervals = [];

  const now = new Date();
  const upcoming = tournaments.filter(t => {
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    const daysLeft = (d - now) / 86400000;
    return daysLeft > 0 && daysLeft <= 7;
  }).sort((a, b) => new Date(a.deadline) - new Date(b.deadline)).slice(0, 4);

  const container = document.getElementById('urgency-container');

  if (upcoming.length === 0) {
    container.innerHTML = `
      <div class="panel">
        <div class="empty-state" style="padding:32px 0">
          <div class="empty-icon">✅</div>
          <div class="empty-title">近期無截止報名</div>
          <div class="empty-desc">目前 7 天內沒有即將截止的比賽報名</div>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="panel" style="display:flex;flex-direction:column;gap:12px">
      ${upcoming.map((t, i) => {
        const cls = deadlineClass(t.deadline);
        return `
          <div class="item-card" style="animation-delay:${i * 0.05}s;padding:14px">
            <div class="item-card-header">
              <div class="item-name" style="font-size:13px">${escHtml(t.name)}</div>
              <span class="item-region region-${t.region}">${regionLabel(t.region)}</span>
            </div>
            <div class="deadline-badge ${cls}">⏰ ${deadlineText(t.deadline)}</div>
            <div id="countdown-${i}"></div>
            ${t.registrationUrl ? `<a href="${t.registrationUrl}" target="_blank" rel="noopener" class="btn-primary" style="margin-top:8px;font-size:12px">立即報名 →</a>` : ''}
          </div>`;
      }).join('')}
    </div>`;

  // Start countdowns
  upcoming.forEach((t, i) => {
    const el = document.getElementById(`countdown-${i}`);
    if (el) {
      const interval = startCountdown(t.deadline, el);
      if (interval) countdownIntervals.push(interval);
    }
  });
}
