import { api } from '../api.js';
import { escHtml, debounce, showToast, openModal, formatTwd, paginate, renderPagination, cardMeta, copyText } from '../utils.js';

const STATUS_LABELS = { in_stock: '庫存', listed: '上架中', sold: '已售出' };
const LANGUAGES = ['日文', '中文', '英文', '韓文'];
const CONDITIONS = ['完美', '近全新', '輕微瑕疵', '明顯瑕疵'];
// Two warehouses share this page: 賣場倉庫 for 卡拍拍 and 網拍倉庫 for other online sales.
// Each has its own items, fee rate (設定) and CSV export.
const CHANNELS = {
  kapaipai: {
    title: '🗃️ 賣場倉庫',
    subtitle: '記錄要在卡拍拍販售的卡片成本、上架價與成交價',
    feeSetting: 'kapaipaiFeeRate',
    feeLabel: '卡拍拍手續費',
    csvName: '卡拍拍倉庫',
    noun: '卡片',
    unit: '張',
    urlHint: '卡拍拍商品頁網址',
  },
  auction: {
    title: '🏷️ 網拍倉庫',
    subtitle: '記錄在蝦皮、露天、Yahoo 拍賣等網拍販售的卡片、卡盒與周邊的成本、上架價與成交價',
    feeSetting: 'auctionFeeRate',
    feeLabel: '網拍手續費',
    csvName: '網拍倉庫',
    noun: '商品',
    unit: '件',
    urlHint: '網拍商品頁網址',
  },
};
// What's for sale. Single cards get the card fields (number, rarity, 遊々亭 link); the rest
// don't, and use their own conditions.
const ITEM_TYPES = {
  card: { label: '單卡', icon: '🎴' },
  sealed: { label: '卡盒／補充包', icon: '📦' },
  supply: { label: '周邊配件', icon: '🧰' },
  other: { label: '其他', icon: '🛍️' },
};
const PRODUCT_CONDITIONS = ['全新未拆', '已拆封', '二手'];
const isCard = i => !i.itemType || i.itemType === 'card';
const unitOf = i => (isCard(i) ? '張' : '件');

// Suggestions only: any platform name can be typed
const PLATFORMS = ['蝦皮購物', '露天拍賣', 'Yahoo 拍賣', 'Facebook 社團', '旋轉拍賣'];

let channel = 'kapaipai';
let items = [];
let marketPrices = new Map();
let feeRate = 0;
let currentStatus = 'all';
let searchQuery = '';
let pageNum = 1;

export async function renderInventory(container, which = 'kapaipai') {
  channel = CHANNELS[which] ? which : 'kapaipai';
  const cfg = CHANNELS[channel];
  // Start fresh each visit so the state matches the freshly rendered tabs and search box
  currentStatus = 'all';
  searchQuery = '';
  pageNum = 1;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${cfg.title}</h1>
        <p class="page-subtitle">${cfg.subtitle}</p>
      </div>
    </div>
    <div class="page-body">
      <div id="inventory-stats"></div>
      <div class="toolbar">
        <input type="search" id="inventory-search" class="search-input" placeholder="🔍 搜尋${channel === 'auction' ? '名稱、編號或平台' : '卡名或編號'}..." />
        <div class="filter-tabs" id="status-tabs">
          <button class="filter-tab active" data-status="all">全部</button>
          <button class="filter-tab" data-status="in_stock">庫存</button>
          <button class="filter-tab" data-status="listed">上架中</button>
          <button class="filter-tab" data-status="sold">已售出</button>
        </div>
        <div class="toolbar-actions">
          <button class="btn-secondary" id="btn-export-csv">⬇ 匯出 CSV</button>
          <button class="btn-primary" id="btn-add-card" style="flex:none">＋ 新增${cfg.noun}</button>
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
    if (btn.dataset.action === 'listing') openListingText(item);
    if (btn.dataset.action === 'media') openMediaViewer(item);
  });

  await load();
}

async function load() {
  try {
    const [inv, watch, settings] = await Promise.all([api.inventory(channel), api.watchlist(), api.settings()]);
    items = inv;
    marketPrices = new Map(watch.items.map(w => [w.id, w.priceTwd]));
    feeRate = Number(settings[CHANNELS[channel].feeSetting]) || 0;
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
        <div class="stat-label">未售出數量</div>
        <div class="stat-sub">上架中 ${sum(items.filter(i => i.status === 'listed'), i => i.quantity)} ${CHANNELS[channel].unit}</div>
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
        <div class="stat-sub">共 ${sum(sold, i => i.quantity)} ${CHANNELS[channel].unit}</div>
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
    return [i.name, i.cardNumber, i.set, i.notes, i.platform, ITEM_TYPES[i.itemType]?.label].some(v => (v || '').toLowerCase().includes(searchQuery));
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
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🗃️</div><div class="empty-title">倉庫還是空的</div><div class="empty-desc">點擊「＋ 新增${CHANNELS[channel].noun}」記錄第一${CHANNELS[channel].unit}要賣的${CHANNELS[channel].noun}</div></div>`;
    return;
  }
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">找不到符合的${CHANNELS[channel].noun}</div><div class="empty-desc">試試換個關鍵字或狀態</div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table class="price-table">
        <thead>
          <tr>
            <th></th>
            <th>${CHANNELS[channel].noun}</th>
            <th>版本／狀況</th>
            <th class="num">數量</th>
            <th class="num">單價成本</th>
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

function thumbHtml(i) {
  const photo = i.media?.find(m => m.kind === 'image');
  const src = i.imageUrl || (photo && mediaUrl(photo));
  return src
    ? `<img src="${escHtml(src)}" alt="" class="price-card-img" loading="lazy" onerror="this.style.display='none'">`
    : `<span style="font-size:28px">${ITEM_TYPES[i.itemType]?.icon || '🎴'}</span>`;
}

function rowHtml(i) {
  const market = marketPrices.get(i.marketId);
  const meta = isCard(i) ? [i.cardNumber, i.rarity].filter(Boolean).join(' · ') : ITEM_TYPES[i.itemType]?.label || '';
  return `
    <tr>
      <td>${thumbHtml(i)}</td>
      <td class="wrap"><strong>${escHtml(i.name)}</strong>${meta ? `<br><span class="text-muted text-sm">${escHtml(meta)}</span>` : ''}</td>
      <td><span class="text-sm">${escHtml([i.language, i.set].filter(Boolean).join(' ') || '—')}</span><br><span class="text-muted text-sm">${escHtml(i.condition || '')}</span></td>
      <td class="num">${i.quantity}</td>
      <td class="num">${formatTwd(i.cost)}${i.costCny != null ? `<br><span class="text-muted text-sm">${formatCny(i.costCny)}</span>` : ''}</td>
      <td class="num">${formatTwd(i.listPrice)}</td>
      <td class="num">${market != null ? `<span class="price-value">${formatTwd(market)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td class="num">${i.status === 'sold' ? formatTwd(i.soldPrice) : '<span class="text-muted">—</span>'}</td>
      <td class="num">${i.profit != null ? `<span class="${i.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${formatTwd(i.profit)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td><span class="status-pill status-${i.status}">${STATUS_LABELS[i.status] || i.status}</span>${i.platform ? `<br><span class="text-muted text-sm">${escHtml(i.platform)}</span>` : ''}${i.soldAt && i.status === 'sold' ? `<br><span class="text-muted text-sm">${escHtml(i.soldAt)}</span>` : ''}</td>
      <td>
        <div class="row-actions">
          ${i.status !== 'sold' ? `<button class="btn-primary btn-sm" data-action="sell" data-id="${i.id}">售出</button>` : ''}
          ${i.status !== 'sold' ? `<button class="btn-secondary btn-sm" data-action="listing" data-id="${i.id}" title="產生上架用的標題和說明">📋 上架文字</button>` : ''}
          ${i.media?.length ? `<button class="btn-secondary btn-sm" data-action="media" data-id="${i.id}" title="看照片／影片">${i.media.some(m => m.kind === 'video') ? '🎬' : '🖼️'} ${i.media.length}</button>` : ''}
          ${i.listingUrl ? `<a class="btn-secondary btn-sm" href="${escHtml(i.listingUrl)}" target="_blank" rel="noopener noreferrer" title="打開上架頁面">🔗</a>` : ''}
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
    <div class="modal-title">${editing ? `編輯${CHANNELS[channel].noun}` : `新增${CHANNELS[channel].noun}`}</div>
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label" for="f-itemType">商品類型</label>
      <select id="f-itemType" name="itemType" form="item-form" class="form-input">
        ${Object.entries(ITEM_TYPES).map(([k, t]) => `<option value="${k}" ${k === (i.itemType || 'card') ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group card-only" style="margin-bottom:16px">
      <label class="form-label" for="picker-q">從遊々亭帶入卡片資料（選填）</label>
      <div style="display:flex;gap:8px">
        <input id="picker-q" class="form-input" placeholder="例如 ピカチュウex、236/187 或 M6a_158" />
        <button class="btn-secondary" id="picker-go" type="button">搜尋</button>
      </div>
      <div class="form-hint">連結後，倉庫會顯示遊々亭市價，並自動加入卡牌市場追蹤</div>
      <div id="picker-results"></div>
    </div>
    <form id="item-form" class="form-grid">
      <div class="form-group span-2">
        <label class="form-label" for="f-name" id="f-name-label">卡名 *</label>
        <input id="f-name" name="name" class="form-input" required value="${val(i.name)}" />
      </div>
      <div class="form-group card-only">
        <label class="form-label" for="f-cardNumber">卡片編號</label>
        <input id="f-cardNumber" name="cardNumber" class="form-input" placeholder="236/187" value="${val(i.cardNumber)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-set">系列</label>
        <input id="f-set" name="set" class="form-input" placeholder="SV8a" value="${val(i.set)}" />
      </div>
      <div class="form-group card-only">
        <label class="form-label" for="f-rarity">稀有度</label>
        <input id="f-rarity" name="rarity" class="form-input" placeholder="SAR、UR..." value="${val(i.rarity)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-language">版本</label>
        <select id="f-language" name="language" class="form-input">${options(LANGUAGES, i.language)}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-condition" id="f-condition-label">卡況</label>
        <select id="f-condition" name="condition" class="form-input">${options(CONDITIONS, i.condition)}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-quantity">數量</label>
        <input id="f-quantity" name="quantity" type="number" min="1" step="1" class="form-input" value="${val(i.quantity)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-costCny" id="f-costCny-label">進價（人民幣／張）</label>
        <input id="f-costCny" name="costCny" type="number" min="0" step="any" class="form-input" placeholder="用台幣買的可留空" value="${val(i.costCny)}" />
        <input type="hidden" name="cnyRate" value="${val(i.cnyRate)}" />
        <div class="form-hint" id="cny-hint">${i.costCny != null && i.cnyRate ? `當時匯率 1 元 = NT$${i.cnyRate}` : '填了會用今天的匯率換成台幣成本'}</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="f-cost">單價成本（NT$）</label>
        <input id="f-cost" name="cost" type="number" min="0" class="form-input" value="${val(i.cost)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="f-listPrice" id="f-listPrice-label">上架價（NT$／張）</label>
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
      ${channel === 'auction' ? `
        <div class="form-group">
          <label class="form-label" for="f-platform">網拍平台</label>
          <input id="f-platform" name="platform" class="form-input" list="platform-list" placeholder="例如：蝦皮購物" value="${val(i.platform)}" />
          <datalist id="platform-list">${PLATFORMS.map(p => `<option value="${escHtml(p)}">`).join('')}</datalist>
        </div>` : ''}
      <div class="form-group ${channel === 'auction' ? '' : 'span-2'}">
        <label class="form-label" for="f-listingUrl">上架網址（選填）</label>
        <input id="f-listingUrl" name="listingUrl" type="url" class="form-input" placeholder="${CHANNELS[channel].urlHint}" value="${val(i.listingUrl)}" />
      </div>
      <div class="form-group span-2">
        <label class="form-label" for="f-media">照片／影片（選填）</label>
        ${editing && i.media?.length ? `
          <div class="media-strip" id="media-existing">
            ${i.media.map(m => `
              <div class="media-tile" data-media="${m.id}" title="${escHtml(m.name)}">
                ${mediaThumb(m)}
                <button type="button" class="media-remove" data-remove-media="${m.id}" aria-label="刪除 ${escHtml(m.name)}">✕</button>
              </div>`).join('')}
          </div>` : ''}
        <input id="f-media" type="file" class="form-input" accept="image/*,video/*" multiple />
        <div class="form-hint" id="media-hint">可以一次選多個檔案，每個最大 ${MAX_UPLOAD_MB} MB。按儲存後才會上傳。</div>
      </div>
      <div class="form-group span-2">
        <label class="form-label" for="f-notes">備註</label>
        <input id="f-notes" name="notes" class="form-input" value="${val(i.notes)}" />
      </div>
      ${editing ? `
        <div class="form-group span-2">
          <label class="form-label" for="f-channel">放在哪個倉庫</label>
          <select id="f-channel" name="channel" class="form-input">
            ${Object.entries(CHANNELS).map(([k, c]) => `<option value="${k}" ${k === channel ? 'selected' : ''}>${c.title}</option>`).join('')}
          </select>
          <div class="form-hint">改到另一個倉庫後，這張卡會從這一頁移走</div>
        </div>` : ''}
    </form>
    <div class="form-error" id="form-error"></div>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="item-form" id="btn-save-item">💾 儲存</button>
    </div>`);

  const form = el.querySelector('#item-form');
  if (editing) form.querySelector('#f-name').focus();

  // Photos and videos already saved can be removed right away; new ones upload on 儲存
  const mediaInput = el.querySelector('#f-media');
  const mediaHint = el.querySelector('#media-hint');
  mediaInput.addEventListener('change', () => {
    const files = [...mediaInput.files];
    const tooBig = files.filter(f => f.size > MAX_UPLOAD_MB * 1048576);
    mediaHint.textContent = tooBig.length
      ? `「${tooBig.map(f => f.name).join('」「')}」超過 ${MAX_UPLOAD_MB} MB，請先壓縮或剪短`
      : files.length ? `已選 ${files.length} 個檔案，共 ${formatSize(files.reduce((n, f) => n + f.size, 0))}，按儲存後上傳` : `可以一次選多個檔案，每個最大 ${MAX_UPLOAD_MB} MB。按儲存後才會上傳。`;
  });
  el.querySelector('#media-existing')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-remove-media]');
    if (!btn || !confirm('要刪除這個照片／影片嗎？刪除後無法復原。')) return;
    try {
      await api.deleteMedia(item.id, btn.dataset.removeMedia);
      btn.closest('.media-tile').remove();
      item.media = item.media.filter(m => m.id !== btn.dataset.removeMedia);
      showToast('已刪除檔案', 'success');
      load();
    } catch (err) {
      showToast(`刪除失敗：${escHtml(err.message)}`, 'error');
    }
  });

  // Card fields only for single cards; other products get product conditions and 件
  const typeSelect = el.querySelector('#f-itemType');
  const applyType = () => {
    const card = typeSelect.value === 'card';
    el.querySelectorAll('.card-only').forEach(g => { g.hidden = !card; });
    el.querySelector('#f-name-label').textContent = card ? '卡名 *' : '商品名稱 *';
    el.querySelector('#f-condition-label').textContent = card ? '卡況' : '狀況';
    const unit = card ? '張' : '件';
    el.querySelector('#f-listPrice-label').textContent = `上架價（NT$／${unit}）`;
    el.querySelector('#f-costCny-label').textContent = `進價（人民幣／${unit}）`;
    const conditions = card ? CONDITIONS : PRODUCT_CONDITIONS;
    const condition = form.condition;
    const keep = conditions.includes(condition.value) ? condition.value : (card ? '完美' : '全新未拆');
    condition.innerHTML = options(conditions, keep);
  };
  typeSelect.addEventListener('change', applyType);
  applyType();

  // 人民幣 cost → NT$ cost at today's rate, recorded with the cost; the NT$ field can still be
  // changed by hand. Editing other fields leaves an earlier conversion as it was.
  let cny = null;
  const cnyHint = el.querySelector('#cny-hint');
  api.rate('CNY').then(r => {
    if (!(r.rate > 0)) throw new Error('no rate');
    cny = r;
    if (form.costCny.value === '') {
      cnyHint.textContent = `今天 1 元 = NT$${r.rate.toFixed(3)}${r.live ? '' : '（連不上匯率網站，用設定裡的備用匯率）'}`;
    }
  }).catch(() => { cnyHint.textContent = '無法取得匯率，請直接填台幣成本'; });
  form.costCny.addEventListener('input', () => {
    if (!cny?.rate) return;
    const amount = parseFloat(form.costCny.value);
    if (!Number.isFinite(amount)) {
      form.cnyRate.value = '';
      return;
    }
    const rate = Math.round(cny.rate * 10000) / 10000;
    form.cost.value = Math.round(amount * rate);
    form.cnyRate.value = rate;
    cnyHint.textContent = `¥${amount} × ${rate} = NT$${form.cost.value}（今天的匯率${cny.live ? '' : '，備用'}）`;
  });

  const pickerResults = el.querySelector('#picker-results');
  const runSearch = async () => {
    const q = el.querySelector('#picker-q').value.trim();
    if (!q) return;
    pickerResults.innerHTML = '<div class="form-hint" style="padding:8px 0">搜尋中...</div>';
    try {
      const { results } = await api.marketSearch(q);
      if (!results.length) {
        pickerResults.innerHTML = '<div class="form-hint" style="padding:8px 0">遊々亭找不到這張卡，請改用日文卡名、卡號（158/103）或系列＋編號（M6a_158）</div>';
        return;
      }
      pickerResults.innerHTML = `<div class="picker-results">${results.map((r, idx) => `
        <button type="button" class="picker-item" data-idx="${idx}">
          ${r.imageUrl ? `<img src="${escHtml(r.imageUrl)}" alt="" loading="lazy">` : ''}
          <span style="flex:1">${escHtml(r.name)}<br><span class="text-muted">${cardMeta(r)}</span></span>
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
    if (!editing) data.channel = channel;
    // Card-only fields are cleared for other products, so hidden values don't linger
    if (data.itemType !== 'card') {
      data.cardNumber = '';
      data.rarity = '';
      data.marketId = '';
      data.imageUrl = '';
      picked = null;
    }
    if (picked) {
      data.marketId = picked.id;
      data.imageUrl = picked.imageUrl;
    }
    const files = [...mediaInput.files];
    if (files.some(f => f.size > MAX_UPLOAD_MB * 1048576)) {
      el.querySelector('#form-error').textContent = `有檔案超過 ${MAX_UPLOAD_MB} MB，請先移除或壓縮`;
      return;
    }
    const btn = el.querySelector('#btn-save-item');
    btn.disabled = true;
    let saved = null;
    try {
      if (picked) await api.addWatch(picked);
      saved = editing ? await api.updateInventory(item.id, data) : await api.addInventory(data);
      // Uploaded one at a time after the item is saved, with progress on the button
      for (const [n, file] of files.entries()) {
        await api.uploadMedia(saved.id, file, p => {
          btn.textContent = `上傳中 ${n + 1}/${files.length}（${Math.round(p * 100)}%）`;
        });
      }
      close();
      const moved = editing && data.channel !== channel;
      showToast(moved ? `已移到${CHANNELS[data.channel].title.replace(/^\S+\s/, '')}` : editing ? '已更新卡片' : '已加入倉庫', 'success');
      await load();
    } catch (err) {
      // Saved but an upload failed: close, so saving again doesn't add the item twice
      if (saved) {
        close();
        showToast(`${CHANNELS[channel].noun}已儲存，但檔案上傳失敗：${escHtml(err.message)}。可以按「編輯」再上傳`, 'error');
        await load();
        return;
      }
      el.querySelector('#form-error').textContent = err.message;
      btn.textContent = '💾 儲存';
      btn.disabled = false;
    }
  });
}

const mediaUrl = (m, download = false) => `/api/media/${m.file}${download ? `?download=${encodeURIComponent(m.name)}` : ''}`;
const formatSize = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const MAX_UPLOAD_MB = 500;

function mediaThumb(m) {
  return m.kind === 'video'
    ? `<video src="${mediaUrl(m)}#t=0.1" preload="metadata" muted playsinline></video><span class="media-play">▶</span>`
    : `<img src="${mediaUrl(m)}" alt="" loading="lazy" />`;
}

// Every photo and video of an item, playable, each with a download link for re-uploading
function openMediaViewer(item) {
  openModal(`
    <div class="modal-title">照片／影片：${escHtml(item.name)}</div>
    <div class="media-viewer">
      ${item.media.map(m => `
        <figure class="media-viewer-item">
          ${m.kind === 'video'
            ? `<video src="${mediaUrl(m)}" controls preload="metadata" playsinline></video>`
            : `<a href="${mediaUrl(m)}" target="_blank" rel="noopener"><img src="${mediaUrl(m)}" alt="${escHtml(m.name)}" /></a>`}
          <figcaption>
            <span class="text-sm">${escHtml(m.name)} · ${formatSize(m.size)}</span>
            <a class="btn-secondary btn-sm" href="${mediaUrl(m, true)}" download>⬇ 下載</a>
          </figcaption>
        </figure>`).join('')}
    </div>
    <p class="form-hint">iPhone 的 HEIC 照片和 HEVC（高效率）影片，部分瀏覽器無法預覽，但一樣可以下載。</p>
    <div class="modal-actions"><button class="btn-secondary" type="button" data-close>關閉</button></div>`);
}

// NT$ with cents only when there are any (NT$9.60, NT$10)
const formatTwdCents = n => `${n < 0 ? '-' : ''}NT$${Math.abs(n).toLocaleString('zh-TW', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2 })}`;

const formatCny = n => `¥${Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;

// Title and description to paste into a listing form. Notes and costs stay private.
function listingText(item) {
  const lang = item.language ? `${item.language.replace(/文$/, '')}版` : '';
  const card = isCard(item);
  const unit = unitOf(item);
  const title = [lang && `【${lang}】`, item.name, card && item.rarity, card ? [item.set, item.cardNumber].filter(Boolean).join(' ') : item.set]
    .filter(Boolean).join(' ').replace('】 ', '】');
  const details = [
    !card && `・類型：${ITEM_TYPES[item.itemType]?.label || '其他'}`,
    item.language && `・版本：${item.language}`,
    item.set && `・系列：${item.set}`,
    card && item.cardNumber && `・編號：${item.cardNumber}`,
    card && item.rarity && `・稀有度：${item.rarity}`,
    item.condition && `・${card ? '卡況' : '狀況'}：${item.condition}`,
    `・數量：${item.quantity} ${unit}`,
    item.listPrice != null && `・售價：NT$${Number(item.listPrice).toLocaleString('zh-TW')}／${unit}`,
  ].filter(Boolean);
  return { title, description: [title, '', ...details].join('\n') };
}

function openListingText(item) {
  const { title, description } = listingText(item);
  const { el } = openModal(`
    <div class="modal-title">上架文字：${escHtml(item.name)}</div>
    <p class="form-hint" style="margin-bottom:12px">可以先修改再複製，貼到${channel === 'auction' ? '網拍平台' : '卡拍拍'}的上架表單。不會包含你的成本和備註。</p>
    <div class="form-group">
      <div class="listing-label"><label class="form-label" for="listing-title">標題</label><button type="button" class="btn-secondary btn-sm" data-copy="listing-title">📋 複製標題</button></div>
      <input id="listing-title" class="form-input" value="${escHtml(title)}" />
    </div>
    <div class="form-group">
      <div class="listing-label"><label class="form-label" for="listing-description">商品說明</label><button type="button" class="btn-secondary btn-sm" data-copy="listing-description">📋 複製說明</button></div>
      <textarea id="listing-description" class="form-input" rows="9">${escHtml(description)}</textarea>
    </div>
    ${item.media?.length ? `<p class="form-hint">照片和影片可以按表格裡的 ${item.media.some(m => m.kind === 'video') ? '🎬' : '🖼️'} 下載，再上傳到平台。</p>` : ''}
    <p class="form-hint">上架後，按「編輯」把狀態改成「上架中」並貼上架網址，表格就會出現 🔗 連到商品頁。</p>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>關閉</button>
    </div>`);
  el.addEventListener('click', e => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const ok = copyText(el.querySelector(`#${btn.dataset.copy}`).value);
    showToast(ok ? (btn.dataset.copy === 'listing-title' ? '已複製標題' : '已複製商品說明') : '無法複製，請手動選取文字', ok ? 'success' : 'error');
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
        <label class="form-label" for="s-feeRate">${CHANNELS[channel].feeLabel}率（%）</label>
        <input id="s-feeRate" name="feeRate" type="number" min="0" max="100" step="0.001" inputmode="decimal" class="form-input" value="${feeRate}" />
        <div class="form-hint" id="sell-fee-hint"></div>
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
  const feeHint = el.querySelector('#sell-fee-hint');
  // Same rounding as the server: the fee to the cent
  const updatePreview = () => {
    const qty = Number(form.quantity.value) || 0;
    const price = Number(form.soldPrice.value) || 0;
    const rate = Number(form.feeRate.value) || 0;
    const fee = Math.round(price * qty * rate) / 100;
    feeHint.textContent = `手續費 ${formatTwdCents(fee)}（成交總額 ${formatTwdCents(price * qty)} × ${rate}%）${feeRate ? `，設定的費率是 ${feeRate}%` : ''}`;
    const profit = price * qty - fee - (Number(form.shipping.value) || 0) - (item.cost || 0) * qty;
    preview.innerHTML = `<span class="${profit >= 0 ? 'profit-pos' : 'profit-neg'}">${formatTwdCents(profit)}</span>`;
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
  const header = ['類型', '名稱', '編號', '系列', '稀有度', '版本', '卡況', '數量', '單張成本', '上架價', '成交價', '手續費', '運費', '淨利', '狀態', '購入日期', '成交日期', '備註', '平台', '上架網址', '人民幣進價', '人民幣匯率'];
  const rows = filtered().map(i => [
    ITEM_TYPES[i.itemType]?.label || '單卡', i.name, i.cardNumber, i.set, i.rarity, i.language, i.condition, i.quantity, i.cost, i.listPrice,
    i.status === 'sold' ? i.soldPrice : '', i.fee, i.shipping, i.profit, STATUS_LABELS[i.status], i.purchasedAt, i.soldAt, i.notes,
    i.platform, i.listingUrl, i.costCny, i.cnyRate,
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  // BOM so Excel opens the Chinese text as UTF-8
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${CHANNELS[channel].csvName}_${new Date().toLocaleDateString('sv-SE')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
