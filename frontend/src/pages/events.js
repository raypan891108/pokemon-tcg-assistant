import { api } from '../api.js';
import { formatDate, regionLabel, escHtml, debounce } from '../utils.js';

let allEvents = [];
let currentRegion = 'all';
let searchQuery = '';

export async function renderEvents(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">🎉 活動資訊</h1>
        <p class="page-subtitle">Pokemon TCG 各地活動、展覽與特別賽事</p>
      </div>
    </div>
    <div class="page-body">
      <div class="toolbar">
        <input type="search" id="event-search" class="search-input" placeholder="🔍 搜尋活動名稱、地點..." />
        <div class="filter-tabs" id="event-region-tabs">
          <button class="filter-tab active" data-region="all">全部</button>
          <button class="filter-tab" data-region="tw">🇹🇼 台灣</button>
          <button class="filter-tab" data-region="jp">🇯🇵 日本</button>
          <button class="filter-tab" data-region="us">🇺🇸 美國</button>
        </div>
      </div>
      <div id="events-grid" class="items-grid">
        <div class="loading-spinner" style="grid-column:1/-1"><div class="spinner"></div><span>載入中...</span></div>
      </div>
    </div>`;

  document.getElementById('event-search').addEventListener('input', debounce(e => {
    searchQuery = e.target.value;
    renderEventList();
  }, 300));

  document.getElementById('event-region-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    document.querySelectorAll('#event-region-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentRegion = btn.dataset.region;
    renderEventList();
  });

  try {
    allEvents = await api.events();
    renderEventList();
  } catch (e) {
    document.getElementById('events-grid').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入資料</div><div class="empty-desc">請確認後端服務已啟動</div></div>`;
  }
}

function renderEventList() {
  let list = allEvents;
  if (currentRegion !== 'all') list = list.filter(e => e.region === currentRegion);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e => e.name.toLowerCase().includes(q) || (e.location || '').toLowerCase().includes(q));
  }

  const grid = document.getElementById('events-grid');
  if (!grid) return;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-title">找不到活動</div><div class="empty-desc">試試換個關鍵字或地區</div></div>`;
    return;
  }

  // Separate upcoming vs past
  const now = new Date();
  const upcoming = list.filter(e => !e.date || new Date(e.date) >= now);
  const past = list.filter(e => e.date && new Date(e.date) < now);

  let html = '';
  if (upcoming.length > 0) {
    html += upcoming.map((e, i) => renderEventCard(e, i)).join('');
  }
  if (past.length > 0 && upcoming.length > 0) {
    html += `<div style="grid-column:1/-1;margin-top:8px;margin-bottom:4px"><div class="section-title">已結束活動</div></div>`;
  }
  if (past.length > 0) {
    html += past.map((e, i) => renderEventCard(e, i, true)).join('');
  }

  grid.innerHTML = html;
}

function renderEventCard(e, i, isPast = false) {
  return `
    <div class="item-card" style="animation-delay:${Math.min(i * 0.04, 0.4)}s;${isPast ? 'opacity:0.6' : ''}">
      <div class="item-card-header">
        <div class="item-name">${escHtml(e.name)}</div>
        <span class="item-region region-${e.region}">${regionLabel(e.region)}</span>
      </div>
      <div class="item-meta">
        ${e.date ? `<div class="item-meta-row"><span class="icon">📅</span><span>${formatDate(e.date)}</span></div>` : ''}
        ${e.location ? `<div class="item-meta-row"><span class="icon">📍</span><span>${escHtml(e.location)}</span></div>` : ''}
        ${e.description ? `<div class="item-meta-row"><span class="icon">ℹ️</span><span>${escHtml(e.description)}</span></div>` : ''}
      </div>
      <div class="item-actions">
        ${e.url ? `<a href="${escHtml(e.url)}" target="_blank" rel="noopener" class="btn-primary">查看詳情 →</a>` : `<span class="btn-secondary" style="pointer-events:none;opacity:0.5">連結待公佈</span>`}
        ${isPast ? `<span class="deadline-badge deadline-urgent" style="align-self:center">已結束</span>` : ''}
      </div>
    </div>`;
}
