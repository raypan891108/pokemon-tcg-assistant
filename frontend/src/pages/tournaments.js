import { api } from '../api.js';
import { formatDate, regionLabel, escHtml, deadlineClass, deadlineText, daysUntil, startCountdown, debounce, paginate, renderPagination } from '../utils.js';

let allTournaments = [];
let currentRegion = 'all';
let showUpcoming = true;
let searchQuery = '';
let pageNum = 1;
let countdownIntervals = [];
const MAP_HIDDEN_KEY = 'tournamentMapHidden';

// The map library is large, so it's downloaded only when this page first shows the map.
// Callbacks on the one promise run in order, so a render queued first finishes first.
let mapModule = null;
const loadMap = () => (mapModule ||= import('../tournament-map.js'));

// Whether the map is collapsed is remembered per browser; storage can be unavailable
function mapHidden() {
  try { return localStorage.getItem(MAP_HIDDEN_KEY) === '1'; } catch { return false; }
}
function setMapHidden(hidden) {
  try { localStorage.setItem(MAP_HIDDEN_KEY, hidden ? '1' : '0'); } catch {}
}

export async function renderTournaments(container) {
  // Start fresh each visit so the state matches the freshly rendered tabs and search box
  currentRegion = 'all';
  showUpcoming = true;
  searchQuery = '';
  pageNum = 1;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">🏆 比賽資訊</h1>
        <p class="page-subtitle">Pokemon TCG 賽事、錦標賽與報名資訊</p>
      </div>
    </div>
    <div class="page-body">
      <div class="toolbar">
        <input type="search" id="tournament-search" class="search-input" placeholder="🔍 搜尋賽事名稱..." />
        <div class="filter-tabs" id="tournament-region-tabs">
          <button class="filter-tab active" data-region="all">全部</button>
          <button class="filter-tab" data-region="tw">🇹🇼 台灣</button>
          <button class="filter-tab" data-region="jp">🇯🇵 日本</button>
          <button class="filter-tab" data-region="us">🇺🇸 美國</button>
        </div>
        <div class="filter-tabs" id="tournament-upcoming-tabs">
          <button class="filter-tab active" data-upcoming="true">即將舉辦</button>
          <button class="filter-tab" data-upcoming="false">全部賽事</button>
        </div>
      </div>
      <!-- Taiwan only for now: venues come with full addresses there -->
      <section class="map-panel" id="tournament-map-panel" hidden>
        <div class="map-panel-header">
          <div>
            <div class="map-panel-title">🗺️ 台灣比賽地圖</div>
            <div class="map-panel-sub" id="tournament-map-sub"></div>
          </div>
          <div class="map-legend">
            <span><i class="map-legend-dot open"></i>開放報名中</span>
            <span><i class="map-legend-dot"></i>已截止／未公布</span>
            <button class="btn-secondary btn-sm" type="button" id="btn-toggle-map" aria-controls="tournament-map"></button>
          </div>
        </div>
        <div id="tournament-map" class="tournament-map"></div>
      </section>
      <div id="tournaments-grid" class="items-grid">
        <div class="loading-spinner" style="grid-column:1/-1"><div class="spinner"></div><span>載入中...</span></div>
      </div>
      <div id="tournaments-pagination"></div>
    </div>`;

  document.getElementById('tournament-search').addEventListener('input', debounce(e => {
    searchQuery = e.target.value;
    pageNum = 1;
    renderTournamentList();
  }, 300));

  document.getElementById('tournament-region-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    document.querySelectorAll('#tournament-region-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentRegion = btn.dataset.region;
    pageNum = 1;
    renderTournamentList();
  });

  document.getElementById('tournament-upcoming-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-upcoming]');
    if (!btn) return;
    document.querySelectorAll('#tournament-upcoming-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    showUpcoming = btn.dataset.upcoming === 'true';
    pageNum = 1;
    renderTournamentList();
  });

  document.getElementById('btn-toggle-map').addEventListener('click', () => {
    setMapHidden(!mapHidden());
    renderTournamentList();
  });

  // 「地圖」 on a card: bring the map into view and open that venue
  document.getElementById('tournaments-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-map-id]');
    if (!btn) return;
    if (mapHidden()) {
      setMapHidden(false);
      renderTournamentList();
    }
    document.getElementById('tournament-map-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadMap().then(m => m.showOnMap(btn.dataset.mapId));
  });

  try {
    allTournaments = await api.tournaments();
    renderTournamentList();
  } catch (e) {
    document.getElementById('tournaments-grid').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入資料</div><div class="empty-desc">請確認後端服務已啟動</div></div>`;
  }
}

function renderTournamentList() {
  // Clear existing countdowns
  countdownIntervals.forEach(clearInterval);
  countdownIntervals = [];

  let list = allTournaments;

  if (currentRegion !== 'all') list = list.filter(t => t.region === currentRegion);

  if (showUpcoming) {
    const now = new Date();
    list = list.filter(t => !t.date || new Date(t.date) >= now);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(t => t.name.toLowerCase().includes(q));
  }

  list.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });

  const grid = document.getElementById('tournaments-grid');
  if (!grid) return;

  renderMapPanel(list);

  const { items, ...pageInfo } = paginate(list, pageNum);
  pageNum = pageInfo.page;
  renderPagination(document.getElementById('tournaments-pagination'), pageInfo, p => {
    pageNum = p;
    renderTournamentList();
  });

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-title">找不到賽事</div><div class="empty-desc">試試換個篩選條件</div></div>`;
    return;
  }

  grid.innerHTML = items.map((t, i) => {
    const days = daysUntil(t.deadline);
    const dClass = deadlineClass(t.deadline);
    return `
      <div class="item-card" style="animation-delay:${Math.min(i * 0.04, 0.4)}s">
        <div class="item-card-header">
          <div class="item-name">${escHtml(t.name)}</div>
          <span class="item-region region-${t.region}">${regionLabel(t.region)}</span>
        </div>
        <div class="item-meta">
          ${t.date ? `<div class="item-meta-row"><span class="icon">📅</span><span>比賽日期：${formatDate(t.date)}</span></div>` : ''}
          ${t.location ? `<div class="item-meta-row"><span class="icon">📍</span><span>${escHtml(t.location)}</span></div>` : ''}
        </div>
        ${t.deadline ? `
          <div style="padding:12px;background:var(--bg-elevated);border-radius:8px">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">⏰ 報名截止</div>
            <div class="deadline-badge ${dClass}" style="margin-bottom:8px">${deadlineText(t.deadline)} · ${formatDate(t.deadline)}</div>
            ${days !== null && days > 0 && days <= 3 ? `<div id="countdown-t-${i}"></div>` : ''}
          </div>
        ` : ''}
        <div class="item-actions">
          ${t.registrationUrl ? `<a href="${escHtml(t.registrationUrl)}" target="_blank" rel="noopener" class="btn-primary">🎯 立即報名</a>` : ''}
          ${t.url && t.url !== t.registrationUrl ? `<a href="${escHtml(t.url)}" target="_blank" rel="noopener" class="btn-secondary">詳細資訊</a>` : ''}
          ${t.geo ? `<button type="button" class="btn-secondary" data-map-id="${escHtml(t.id)}">📍 地圖</button>` : ''}
          ${!t.registrationUrl && !t.url ? `<span class="btn-secondary" style="pointer-events:none;opacity:0.5">連結待公佈</span>` : ''}
        </div>
      </div>`;
  }).join('');

  // Start countdowns for urgent deadlines on this page
  items.forEach((t, i) => {
    const days = daysUntil(t.deadline);
    if (days !== null && days > 0 && days <= 3) {
      const el = document.getElementById(`countdown-t-${i}`);
      if (el) {
        const interval = startCountdown(t.deadline, el);
        if (interval) countdownIntervals.push(interval);
      }
    }
  });
}

// The map shows the same filtered list as the cards (all pages of it), for Taiwan
function renderMapPanel(list) {
  const panel = document.getElementById('tournament-map-panel');
  panel.hidden = !['all', 'tw'].includes(currentRegion);
  if (panel.hidden) return;

  const taiwan = list.filter(t => t.region === 'tw');
  const hidden = mapHidden();
  const mapEl = document.getElementById('tournament-map');
  mapEl.hidden = hidden;
  document.getElementById('btn-toggle-map').textContent = hidden ? '展開地圖' : '收起地圖';
  document.getElementById('btn-toggle-map').setAttribute('aria-expanded', String(!hidden));

  const located = taiwan.filter(t => t.geo).length;
  const missing = taiwan.length - located;
  document.getElementById('tournament-map-sub').textContent = taiwan.length
    ? `${located} 場比賽${missing ? `，另有 ${missing} 場沒有地址或還在定位中` : ''}`
    : '目前的篩選條件下沒有台灣的比賽';
  if (hidden) return;
  loadMap().then(m => {
    // Skip if the page was left or re-rendered while the map code was loading
    if (mapEl.isConnected) m.renderTournamentMap(mapEl, taiwan);
  }).catch(() => {
    mapEl.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">地圖載入失敗</div></div>';
  });
}
