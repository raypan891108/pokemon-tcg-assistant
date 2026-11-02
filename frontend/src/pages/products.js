import { api } from '../api.js';
import { formatDate, regionLabel, escHtml, debounce } from '../utils.js';

let allProducts = [];
let currentRegion = 'all';
let searchQuery = '';

export async function renderProducts(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">📦 新商品</h1>
        <p class="page-subtitle">台灣、日本、美國最新 TCG 商品資訊</p>
      </div>
    </div>
    <div class="page-body">
      <div class="toolbar">
        <input type="search" id="product-search" class="search-input" placeholder="🔍 搜尋商品名稱..." />
        <div class="filter-tabs" id="region-tabs">
          <button class="filter-tab active" data-region="all" id="tab-products-all">全部</button>
          <button class="filter-tab" data-region="tw" id="tab-products-tw">🇹🇼 台灣</button>
          <button class="filter-tab" data-region="jp" id="tab-products-jp">🇯🇵 日本</button>
          <button class="filter-tab" data-region="us" id="tab-products-us">🇺🇸 美國</button>
        </div>
      </div>
      <div id="products-grid" class="items-grid">
        <div class="loading-spinner" style="grid-column:1/-1"><div class="spinner"></div><span>載入中...</span></div>
      </div>
    </div>`;

  // Bind events
  const searchInput = document.getElementById('product-search');
  searchInput.addEventListener('input', debounce(e => {
    searchQuery = e.target.value;
    renderProductList();
  }, 300));

  document.getElementById('region-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-region]');
    if (!btn) return;
    document.querySelectorAll('#region-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentRegion = btn.dataset.region;
    renderProductList();
  });

  try {
    allProducts = await api.products();
    renderProductList();
  } catch (e) {
    document.getElementById('products-grid').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入資料</div><div class="empty-desc">請確認後端服務已啟動</div></div>`;
  }
}

function renderProductList() {
  let list = allProducts;
  if (currentRegion !== 'all') list = list.filter(p => p.region === currentRegion);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(q));
  }

  const grid = document.getElementById('products-grid');
  if (!grid) return;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-title">找不到商品</div><div class="empty-desc">試試換個關鍵字或地區</div></div>`;
    return;
  }

  grid.innerHTML = list.map((p, i) => `
    <div class="item-card" style="animation-delay:${Math.min(i * 0.04, 0.4)}s">
      ${p.imageUrl ? `<img src="${escHtml(p.imageUrl)}" alt="${escHtml(p.name)}" style="width:100%;height:160px;object-fit:cover;border-radius:8px;margin-bottom:4px;" onerror="this.style.display='none'" loading="lazy">` : ''}
      <div class="item-card-header">
        <div class="item-name">${escHtml(p.name)}</div>
        <span class="item-region region-${p.region}">${regionLabel(p.region)}</span>
      </div>
      <div class="flex gap-2 items-center" style="flex-wrap:wrap">
        <span class="item-type">${p.type || '補充包'}</span>
        ${p.releaseDate ? `<span class="text-muted text-sm">📅 ${formatDate(p.releaseDate)}</span>` : ''}
      </div>
      ${p.description ? `<p class="text-muted text-sm">${escHtml(p.description)}</p>` : ''}
      <div class="item-actions">
        ${p.url ? `<a href="${escHtml(p.url)}" target="_blank" rel="noopener" class="btn-primary">查看詳情 →</a>` : `<span class="btn-secondary" style="pointer-events:none;opacity:0.5">連結待公佈</span>`}
      </div>
    </div>`).join('');
}
