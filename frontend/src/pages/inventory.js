import { api } from '../api.js';
import { escHtml, debounce, showToast, openModal, formatTwd, paginate, renderPagination } from '../utils.js';

const STATUS_LABELS = { in_stock: '庫存', listed: '上架中', sold: '已售出' };
const LANGUAGES = ['日文', '中文', '英文', '韓文'];
const CONDITIONS = ['完美', '近全新', '輕微瑕疵', '明顯瑕疵'];

let items = [];
let marketPrices = new Map();
let feeRate = 0;
let currentStatus = 'all';
let searchQuery = '';
let pageNum = 1;

export async function renderInventory(container) {
  // Start fresh each visit so the state matches the freshly rendered tabs and search box
  currentStatus = 'all';
  searchQuery = '';
  pageNum = 1;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">🗃️ 賣場倉庫</h1>
        <p class="page-subtitle">記錄要在卡拍拍販售的卡片成本、上架價與成交價</p>
      </div>
    </div>
    <div class="page-body">
      <div id="inventory-stats"></div>
      <div class="toolbar">
        <input type="search" id="inventory-search" class="search-input" placeholder="🔍 搜尋卡名或編號..." />
        <div class="filter-tabs" id="status-tabs">
          <button class="filter-tab active" data-status="all">全部</button>
          <button class="filter-tab" data-status="in_stock">庫存</button>
          <button class="filter-tab" data-status="listed">上架中</button>
          <button class="filter-tab" data-status="sold">已售出</button>
        </div>
        <div class="toolbar-actions">
          <button class="btn-secondary" id="btn-export-csv">⬇ 匯出 CSV</button>
          <button class="btn-primary" id="btn-add-card" style="flex:none">＋ 新增卡片</button>
        </div>
      </div>
      <div id="inventory-table">
        <div class="loading-spinner"><div class="spinner"></div><span>載入中...</span></div>
      </div>
      <div id="inventory-pagination"></div>
    </div>`;

  document.getElementById('inventory-search').addEventListener('input', debounce(e => {
    searchQuery = e.target.value.trim().toLowerCase();
    pageNum = 1;
    renderTable();
  }, 200));

  document.getElementById('status-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    document.querySelectorAll('#status-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentStatus = btn.dataset.status;
    pageNum = 1;
    renderTable();
  });

  document.getElementById('btn-add-card').addEventListener('click', () => openItemForm());
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);

  document.getElementById('inventory-table').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const item = items.find(i => i.id === btn.dataset.id);
    if (!item) return;
    if (btn.dataset.action === 'edit') openItemForm(item);
    if (btn.dataset.action === 'sell') openSellForm(item);
    if (btn.dataset.action === 'delete') deleteItem(item);
  });

  await load();
}

async function load() {
  try {
    const [inv, watch, settings] = await Promise.all([api.inventory(), api.watchlist(), api.settings()]);
    items = inv;
    marketPrices = new Map(watch.items.map(w => [w.id, w.priceTwd]));
    feeRate = Number(settings.kapaipaiFeeRate) || 0;
    renderStats();
    renderTable();
  } catch (e) {
    document.getElementById('inventory-table').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入倉庫</div><div class="empty-desc">請確認後端服務已啟動</div></div>`;
  }
}

function renderStats() {
  const unsold = items.filter(i => i.status !== 'sold');
  const sold = items.filter(i => i.status === 'sold');
  const sum = (list, fn) => list.reduce((acc, i) => acc + (fn(i) || 0), 0);
  const unsoldQty = sum(unsold, i => i.quantity);
  const unsoldCost = sum(unsold, i => i.totalCost);
  const pricedUnsold = unsold.filter(i => marketPrices.get(i.marketId) != null);
  const marketValue = sum(pricedUnsold, i => marketPrices.get(i.marketId) * i.quantity);
  const revenue = sum(sold, i => i.revenue);
  const profit = sum(sold, i => i.profit);

  document.getElementById('inventory-stats').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-value">${unsoldQty}</div>
        <div class="stat-label">未售出張數</div>
        <div class="stat-sub">上架中 ${sum(items.filter(i => i.status === 'listed'), i => i.quantity)} 張</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">💰</div>
        <div class="stat-value">${formatTwd(unsoldCost)}</div>
        <div class="stat-label">庫存成本</div>
        <div class="stat-sub">${pricedUnsold.length ? `遊々亭市值約 ${formatTwd(marketValue)}` : '連結遊々亭卡片即可估市值'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🧾</div>
        <div class="stat-value">${formatTwd(revenue)}</div>
        <div class="stat-label">已售出營收</div>
        <div class="stat-sub">共 ${sum(sold, i => i.quantity)} 張</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📈</div>
        <div class="stat-value ${profit < 0 ? 'profit-neg' : ''}">${formatTwd(profit)}</div>
        <div class="stat-label">已實現淨利</div>
        <div class="stat-sub">扣除成本、手續費與運費</div>
      </div>
    </div>`;
}

function filtered() {
  return items.filter(i => {
    if (currentStatus !== 'all' && i.status !== currentStatus) return false;
    if (!searchQuery) return true;
    return [i.name, i.cardNumber, i.set, i.notes].some(v => (v || '').toLowerCase().includes(searchQuery));
  });
}

function renderTable() {
  const el = document.getElementById('inventory-table');
  if (!el) return;
  const list = filtered();

  // Stays on the same page after an edit, sale or delete (clamped if that page is now gone)
  const { items: pageItems, ...pageInfo } = paginate(list, pageNum);
  pageNum = pageInfo.page;
  renderPagination(document.getElementById('inventory-pagination'), pageInfo, p => {
    pageNum = p;
    renderTable();
  });

  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🗃️</div><div class="empty-title">倉庫還是空的</div><div class="empty-desc">點擊「＋ 新增卡片」記錄第一張要賣的卡</div></div>`;
    return;
  }
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">找不到符合的卡片</div><div class="empty-desc">試試換個關鍵字或狀態</div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table class="price-table">
        <thead>
          <tr>
            <th></th>
            <th>卡片</th>
            <th>版本／卡況</th>
            <th class="num">數量</th>
            <th class="num">單張成本</th>
            <th class="num">上架價</th>
            <th class="num">遊々亭市價</th>
            <th class="num">成交價</th>
            <th class="num">淨利</th>
            <th>狀態</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${pageItems.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`;
}

function rowHtml(i) {
  const market = marketPrices.get(i.marketId);
  const meta = [i.cardNumber, i.rarity].filter(Boolean).join(' · ');
  return `
    <tr>
      <td>${i.imageUrl ? `<img src="${escHtml(i.imageUrl)}" alt="" class="price-card-img" loading="lazy" onerror="this.style.display='none'">` : '<span style="font-size:28px">🎴</span>'}</td>
      <td class="wrap"><strong>${escHtml(i.name)}</strong>${meta ? `<br><span class="text-muted text-sm">${escHtml(meta)}</span>` : ''}</td>
      <td><span class="text-sm">${escHtml([i.language, i.set].filter(Boolean).join(' ') || '—')}</span><br><span class="text-muted text-sm">${escHtml(i.condition || '')}</span></td>
      <td class="num">${i.quantity}</td>
      <td class="num">${formatTwd(i.cost)}</td>
      <td class="num">${formatTwd(i.listPrice)}</td>
      <td class="num">${market != null ? `<span class="price-value">${formatTwd(market)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td class="num">${i.status === 'sold' ? formatTwd(i.soldPrice) : '<span class="text-muted">—</span>'}</td>
      <td class="num">${i.profit != null ? `<span class="${i.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${formatTwd(i.profit)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td><span class="status-pill status-${i.status}">${STATUS_LABELS[i.status] || i.status}</span>${i.soldAt && i.status === 'sold' ? `<br><span class="text-muted text-sm">${escHtml(i.soldAt)}</span>` : ''}</td>
      <td>
        <div class="row-actions">
          ${i.status !== 'sold' ? `<button class="btn-primary btn-sm" data-action="sell" data-id="${i.id}">售出</button>` : ''}
          <button class="btn-secondary btn-sm" data-action="edit" data-id="${i.id}">編輯</button>
          <button class="btn-secondary btn-sm" data-action="delete" data-id="${i.id}" aria-label="刪除">🗑</button>
        </div>
      </td>
    </tr>`;
}

function options(list, selected, blank = true) {
  return (blank ? '<option value="">—</option>' : '') +
    list.map(v => `<option value="${escHtml(v)}" ${v === selected ? 'selected' : ''}>${escHtml(v)}</option>`).join('');
}

function val(v) {
  return v === null || v === undefined ? '' : escHtml(String(v));
}

function openItemForm(item = null) {
  const editing = !!item;
  const i = item || { quantity: 1, status: 'in_stock', language: '日文', condition: '完美' };
  let picked = null;

  const { el, close } = openModal(`
    <div class="modal-title">${editing ? '編輯卡片' : '新增卡片'}</div>
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label" for="picker-q">從遊々亭帶入卡片資料（選填）</label>
      <div style="display:flex;gap:8px">
        <input id="picker-q" class="form-input" placeholder="日文卡名或卡號，例如 ピカチュウex 或 236/187" />
        <button class="btn-secondary" id="picker-go" type="button">搜尋</button>
      </div>
      <div class="form-hint">連結後，倉庫會顯示遊々亭市價，並自動加入卡牌市場追蹤</div>
      <div id="picker-results"></div>
    </div>
    <form id="item-form" class="form-grid">
      <div class="form-group span-2">
        <label class="form-label" for="f-name">卡名 *</label>
        <input id="f-name" name="name" class="form-input" required value="${val(i.name)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-cardNumber">卡片編號</label>
        <input id="f-cardNumber" name="cardNumber" class="form-input" placeholder="236/187" value="${val(i.cardNumber)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-set">系列</label>
        <input id="f-set" name="set" class="form-input" placeholder="SV8a" value="${val(i.set)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-rarity">稀有度</label>
        <input id="f-rarity" name="rarity" class="form-input" placeholder="SAR、UR..." value="${val(i.rarity)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-language">版本</label>
        <select id="f-language" name="language" class="form-input">${options(LANGUAGES, i.language)}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-condition">卡況</label>
        <select id="f-condition" name="condition" class="form-input">${options(CONDITIONS, i.condition)}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-quantity">數量</label>
        <input id="f-quantity" name="quantity" type="number" min="1" step="1" class="form-input" value="${val(i.quantity)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-cost">單張成本（NT$）</label>
        <input id="f-cost" name="cost" type="number" min="0" class="form-input" value="${val(i.cost)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-listPrice">上架價（NT$／張）</label>
        <input id="f-listPrice" name="listPrice" type="number" min="0" class="form-input" value="${val(i.listPrice)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-status">狀態</label>
        <select id="f-status" name="status" class="form-input">
          ${Object.entries(STATUS_LABELS).filter(([k]) => editing && i.status === 'sold' ? true : k !== 'sold')
            .map(([k, label]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-purchasedAt">購入日期</label>
        <input id="f-purchasedAt" name="purchasedAt" type="date" class="form-input" value="${val(i.purchasedAt)}" />
      </div>
      ${editing && i.status === 'sold' ? `
        <div class="form-group">
          <label class="form-label" for="f-soldPrice">成交價（NT$／張）</label>
          <input id="f-soldPrice" name="soldPrice" type="number" min="0" class="form-input" value="${val(i.soldPrice)}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-soldAt">成交日期</label>
          <input id="f-soldAt" name="soldAt" type="date" class="form-input" value="${val(i.soldAt)}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-fee">手續費（NT$）</label>
          <input id="f-fee" name="fee" type="number" min="0" class="form-input" value="${val(i.fee)}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="f-shipping">運費（NT$）</label>
          <input id="f-shipping" name="shipping" type="number" min="0" class="form-input" value="${val(i.shipping)}" />
        </div>` : ''}
      <div class="form-group span-2">
        <label class="form-label" for="f-notes">備註</label>
        <input id="f-notes" name="notes" class="form-input" value="${val(i.notes)}" />
      </div>
    </form>
    <div class="form-error" id="form-error"></div>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="item-form" id="btn-save-item">💾 儲存</button>
    </div>`);

  const form = el.querySelector('#item-form');
  if (editing) form.querySelector('#f-name').focus();

  const pickerResults = el.querySelector('#picker-results');
  const runSearch = async () => {
    const q = el.querySelector('#picker-q').value.trim();
    if (!q) return;
    pickerResults.innerHTML = '<div class="form-hint" style="padding:8px 0">搜尋中...</div>';
    try {
      const { results } = await api.marketSearch(q);
      if (!results.length) {
        pickerResults.innerHTML = '<div class="form-hint" style="padding:8px 0">遊々亭找不到這張卡，請改用日文卡名或卡號</div>';
        return;
      }
      pickerResults.innerHTML = `<div class="picker-results">${results.map((r, idx) => `
        <button type="button" class="picker-item" data-idx="${idx}">
          ${r.imageUrl ? `<img src="${escHtml(r.imageUrl)}" alt="" loading="lazy">` : ''}
          <span style="flex:1">${escHtml(r.name)}<br><span class="text-muted">${escHtml(r.set)} · ${escHtml(r.cardNumber)} · ${escHtml(r.rarity)}</span></span>
          <span class="price-value">${formatTwd(r.priceTwd)}</span>
        </button>`).join('')}</div>`;
      pickerResults.querySelectorAll('.picker-item').forEach(b => b.addEventListener('click', () => {
        picked = results[Number(b.dataset.idx)];
        form.name.value = picked.name;
        form.cardNumber.value = picked.cardNumber;
        form.set.value = picked.set;
        form.rarity.value = picked.rarity;
        form.language.value = '日文';
        pickerResults.innerHTML = `<div class="form-hint" style="padding:8px 0">✅ 已連結遊々亭：${escHtml(picked.name)} ${escHtml(picked.cardNumber)}（市價 ${formatTwd(picked.priceTwd)}）</div>`;
      }));
    } catch (err) {
      pickerResults.innerHTML = `<div class="form-error">${escHtml(err.message)}</div>`;
    }
  };
  el.querySelector('#picker-go').addEventListener('click', runSearch);
  el.querySelector('#picker-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (picked) {
      data.marketId = picked.id;
      data.imageUrl = picked.imageUrl;
    }
    const btn = el.querySelector('#btn-save-item');
    btn.disabled = true;
    try {
      if (picked) await api.addWatch(picked);
      if (editing) await api.updateInventory(item.id, data);
      else await api.addInventory(data);
      close();
      showToast(editing ? '已更新卡片' : '已加入倉庫', 'success');
      await load();
    } catch (err) {
      el.querySelector('#form-error').textContent = err.message;
      btn.disabled = false;
    }
  });
}

function openSellForm(item) {
  const today = new Date().toLocaleDateString('sv-SE');
  const { el, close } = openModal(`
    <div class="modal-title">售出：${escHtml(item.name)}</div>
    <form id="sell-form" class="form-grid">
      <div class="form-group">
        <label class="form-label" for="s-quantity">售出數量（最多 ${item.quantity}）</label>
        <input id="s-quantity" name="quantity" type="number" min="1" max="${item.quantity}" step="1" class="form-input" value="${item.quantity}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="s-soldPrice">成交價（NT$／張）*</label>
        <input id="s-soldPrice" name="soldPrice" type="number" min="0" class="form-input" required value="${val(item.listPrice)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="s-fee">卡拍拍手續費（NT$）</label>
        <input id="s-fee" name="fee" type="number" min="0" class="form-input" />
        <div class="form-hint">${feeRate ? `留空會依設定的 ${feeRate}% 自動計算` : '留空視為 0，可到「設定」填入手續費率'}</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="s-shipping">運費（NT$）</label>
        <input id="s-shipping" name="shipping" type="number" min="0" class="form-input" placeholder="0" />
      </div>
      <div class="form-group">
        <label class="form-label" for="s-soldAt">成交日期</label>
        <input id="s-soldAt" name="soldAt" type="date" class="form-input" value="${today}" />
      </div>
      <div class="form-group">
        <span class="form-label">預估淨利</span>
        <div id="sell-preview" style="font-size:20px;padding-top:6px"></div>
      </div>
    </form>
    <div class="form-error" id="sell-error"></div>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="sell-form" id="btn-confirm-sell">確認售出</button>
    </div>`);

  const form = el.querySelector('#sell-form');
  const preview = el.querySelector('#sell-preview');
  const updatePreview = () => {
    const qty = Number(form.quantity.value) || 0;
    const price = Number(form.soldPrice.value) || 0;
    const fee = form.fee.value === '' ? Math.round(price * qty * feeRate / 100) : Number(form.fee.value);
    const profit = price * qty - fee - (Number(form.shipping.value) || 0) - (item.cost || 0) * qty;
    preview.innerHTML = `<span class="${profit >= 0 ? 'profit-pos' : 'profit-neg'}">${formatTwd(profit)}</span>`;
  };
  form.addEventListener('input', updatePreview);
  updatePreview();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = el.querySelector('#btn-confirm-sell');
    btn.disabled = true;
    try {
      await api.sellInventory(item.id, Object.fromEntries(new FormData(form).entries()));
      close();
      showToast('已記錄成交', 'success');
      await load();
    } catch (err) {
      el.querySelector('#sell-error').textContent = err.message;
      btn.disabled = false;
    }
  });
}

async function deleteItem(item) {
  if (!confirm(`確定要刪除「${item.name}」這筆紀錄嗎？刪除後無法復原。`)) return;
  try {
    await api.deleteInventory(item.id);
    showToast('已刪除', 'success');
    await load();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function exportCsv() {
  const header = ['卡名', '編號', '系列', '稀有度', '版本', '卡況', '數量', '單張成本', '上架價', '成交價', '手續費', '運費', '淨利', '狀態', '購入日期', '成交日期', '備註'];
  const rows = filtered().map(i => [
    i.name, i.cardNumber, i.set, i.rarity, i.language, i.condition, i.quantity, i.cost, i.listPrice,
    i.status === 'sold' ? i.soldPrice : '', i.fee, i.shipping, i.profit, STATUS_LABELS[i.status], i.purchasedAt, i.soldAt, i.notes,
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  // BOM so Excel opens the Chinese text as UTF-8
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `卡拍拍倉庫_${new Date().toLocaleDateString('sv-SE')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
