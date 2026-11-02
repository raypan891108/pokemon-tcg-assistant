import { api } from '../api.js';
import { escHtml, showToast, formatTwd, paginate, renderPagination, cardMeta, openModal } from '../utils.js';
import { renderPriceChart } from '../price-chart.js';

let searchResults = [];
let watchlist = { rate: 0, items: [] };
let pageNum = 1;

export async function renderMarket(container) {
  pageNum = 1;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">💹 卡牌市場</h1>
        <p class="page-subtitle">遊々亭日本單卡售價，換算台幣作為定價參考</p>
      </div>
    </div>
    <div class="page-body">
      <div class="settings-section">
        <div class="settings-title">🔍 查詢卡價</div>
        <form id="market-search-form" style="display:flex;gap:10px">
          <input type="search" id="market-q" class="form-input" placeholder="例如 リザードンex、236/187 或 M6a_158" />
          <button class="btn-primary" type="submit" style="flex:none;min-width:96px">搜尋</button>
        </form>
        <div class="form-hint" style="margin-top:8px">可以輸入日文卡名、卡號（158/103），或卡片上的系列＋編號（M6a_158）。中文卡名查不到</div>
        <div id="market-results" style="margin-top:16px"></div>
      </div>

      <div class="toolbar" style="margin-bottom:12px">
        <div class="section-title" style="margin:0">⭐ 追蹤清單</div>
        <div class="toolbar-actions">
          <button class="btn-secondary" id="btn-refresh-market">↻ 立即更新價格</button>
        </div>
      </div>
      <div id="watchlist">
        <div class="loading-spinner"><div class="spinner"></div><span>載入中...</span></div>
      </div>
      <div id="watchlist-pagination"></div>
    </div>`;

  document.getElementById('market-search-form').addEventListener('submit', e => {
    e.preventDefault();
    runSearch(document.getElementById('market-q').value.trim());
  });

  document.getElementById('market-results').addEventListener('click', async e => {
    const btn = e.target.closest('[data-watch]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await api.addWatch(searchResults[Number(btn.dataset.watch)]);
      btn.textContent = '✓ 已追蹤';
      await loadWatchlist();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  });

  document.getElementById('watchlist').addEventListener('click', async e => {
    const chartBtn = e.target.closest('[data-chart]');
    if (chartBtn) {
      const item = watchlist.items.find(i => i.id === chartBtn.dataset.chart);
      if (item) openChart(item);
      return;
    }
    const btn = e.target.closest('[data-unwatch]');
    if (!btn) return;
    try {
      await api.removeWatch(btn.dataset.unwatch);
      await loadWatchlist();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-refresh-market').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const toast = showToast('正在更新遊々亭價格...', 'loading', 0);
    try {
      const { updated, errors } = await api.refreshMarket();
      toast.remove();
      showToast(errors.length ? `已更新 ${updated} 張，${errors.length} 張失敗` : `已更新 ${updated} 張卡的價格`, errors.length ? 'error' : 'success');
      await loadWatchlist();
    } catch (err) {
      toast.remove();
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  await loadWatchlist();
}

async function runSearch(q) {
  const el = document.getElementById('market-results');
  if (!q) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>搜尋遊々亭...</span></div>';
  try {
    const { rate, results } = await api.marketSearch(q);
    searchResults = results;
    if (!results.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><div class="empty-title">找不到「${escHtml(q)}」</div><div class="empty-desc">請改用日文卡名、卡號（158/103）或系列＋編號（M6a_158）</div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="form-hint" style="margin-bottom:10px">共 ${results.length} 筆 · 匯率 1 円 ≈ NT$${rate.toFixed(4)}</div>
      <div class="card-results">
        ${results.map((r, idx) => `
          <div class="card-result">
            <a href="${escHtml(r.url)}" target="_blank" rel="noopener">
              ${r.imageUrl ? `<img src="${escHtml(r.imageUrl)}" alt="${escHtml(r.name)}" loading="lazy">` : ''}
            </a>
            <strong>${escHtml(r.name)}</strong>
            <span class="text-muted text-sm">${cardMeta(r)}</span>
            <span><span class="price-value">${formatTwd(r.priceTwd)}</span> <span class="text-muted text-sm">（${r.priceJpy != null ? r.priceJpy.toLocaleString() + ' 円' : '—'}）</span></span>
            <span class="text-sm ${r.stock ? 'text-muted' : 'profit-neg'}">${r.stock ? `在庫 ${r.stock}` : '缺貨'}</span>
            <button class="btn-primary btn-sm" data-watch="${idx}">＋ 追蹤</button>
          </div>`).join('')}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="form-error">${escHtml(err.message)}</div>`;
  }
}

async function loadWatchlist() {
  const el = document.getElementById('watchlist');
  if (!el) return;
  try {
    watchlist = await api.watchlist();
    renderWatchlist();
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入追蹤清單</div><div class="empty-desc">${escHtml(err.message)}</div></div>`;
  }
}

// Stays on the same page after adding or removing a card (clamped if that page is now gone)
function renderWatchlist() {
  const el = document.getElementById('watchlist');
  if (!el) return;
  const { rate } = watchlist;
  const { items, ...pageInfo } = paginate(watchlist.items, pageNum);
  pageNum = pageInfo.page;
  renderPagination(document.getElementById('watchlist-pagination'), pageInfo, p => {
    pageNum = p;
    renderWatchlist();
  });

  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⭐</div><div class="empty-title">還沒有追蹤的卡片</div><div class="empty-desc">搜尋卡片後按「＋ 追蹤」，每次更新資料時會記錄價格變化</div></div>`;
    return;
  }
  el.innerHTML = `
    <div class="table-wrap">
      <table class="price-table">
        <thead>
          <tr>
            <th></th>
            <th>卡片</th>
            <th class="num">台幣</th>
            <th class="num">日幣</th>
            <th class="num">變動</th>
            <th class="num">在庫</th>
            <th>更新時間</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(i => {
            const change = i.previousJpy && i.priceJpy ? (i.priceJpy - i.previousJpy) / i.previousJpy * 100 : null;
            return `
              <tr>
                <td>${i.imageUrl ? `<img src="${escHtml(i.imageUrl)}" alt="" class="price-card-img" loading="lazy">` : ''}</td>
                <td class="wrap"><a href="${escHtml(i.url)}" target="_blank" rel="noopener" style="color:inherit"><strong>${escHtml(i.name)}</strong></a><br><span class="text-muted text-sm">${cardMeta(i)}</span>${alertTag(i)}</td>
                <td class="num"><span class="price-value">${formatTwd(i.priceTwd)}</span></td>
                <td class="num">${i.priceJpy != null ? i.priceJpy.toLocaleString() + ' 円' : '—'}</td>
                <td class="num">${change == null ? '<span class="text-muted">—</span>' : change > 0 ? `<span class="price-change-up">▲ ${change.toFixed(1)}%</span>` : `<span class="price-change-down">▼ ${Math.abs(change).toFixed(1)}%</span>`}</td>
                <td class="num">${i.stock ?? '—'}</td>
                <td><span class="text-muted text-sm">${i.updatedAt ? new Date(i.updatedAt).toLocaleString('zh-TW') : '—'}</span></td>
                <td>
                  <div class="row-actions">
                    <button class="btn-secondary btn-sm" data-chart="${escHtml(i.id)}">📈 走勢</button>
                    <button class="btn-secondary btn-sm" data-unwatch="${escHtml(i.id)}">移除</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <p class="form-hint" style="margin-top:10px">匯率 1 円 ≈ NT$${rate.toFixed(4)} · 每次排程更新時自動記錄價格 · 價格僅供參考，實際以各平台成交為準</p>`;
}

// 🔔 line under the card name: the alert prices, highlighted once the price has crossed one
function alertTag(i) {
  const parts = [];
  const state = i.alertState || {};
  if (i.alertBelowTwd != null) parts.push(`${state.below ? '已' : ''}低於 ${formatTwd(i.alertBelowTwd)}`);
  if (i.alertAboveTwd != null) parts.push(`${state.above ? '已' : ''}高於 ${formatTwd(i.alertAboveTwd)}`);
  if (!parts.length) return '';
  const hit = state.below || state.above;
  return `<br><span class="alert-tag ${hit ? 'alert-hit' : ''}">🔔 ${parts.join(' · ')}</span>`;
}

async function openChart(item) {
  const webhookSet = await api.settings().then(s => !!s.discordWebhook).catch(() => true);
  const { rate } = watchlist;
  const prices = (item.history || []).map(h => h.priceJpy).filter(v => v != null);
  const twd = (jpy) => Math.round(jpy * rate);
  const recent = [...(item.history || [])].reverse().slice(0, 30);

  const { el, close } = openModal(`
    <div class="modal-title">📈 ${escHtml(item.name)} <span class="text-muted text-sm">${cardMeta(item)}</span></div>
    ${prices.length ? `
      <div class="chart-stats">
        <span>目前 <strong>${formatTwd(item.priceTwd)}</strong></span>
        <span>最低 ${formatTwd(twd(Math.min(...prices)))}</span>
        <span>最高 ${formatTwd(twd(Math.max(...prices)))}</span>
        <span class="text-muted">${prices.length} 筆紀錄</span>
      </div>` : ''}
    <div id="price-chart"></div>
    <p class="form-hint" style="margin-top:6px">台幣以目前匯率換算（1 円 ≈ NT$${rate.toFixed(4)}）</p>

    <div class="settings-title" style="margin:20px 0 12px">🔔 價格提醒</div>
    <form id="alert-form" class="form-grid">
      <div class="form-group">
        <label class="form-label" for="a-below">低於多少時通知（NT$）</label>
        <input id="a-below" name="alertBelowTwd" type="number" min="1" class="form-input" placeholder="例如 1000" value="${item.alertBelowTwd ?? ''}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="a-above">高於多少時通知（NT$）</label>
        <input id="a-above" name="alertAboveTwd" type="number" min="1" class="form-input" placeholder="例如 3000" value="${item.alertAboveTwd ?? ''}" />
      </div>
    </form>
    <div class="form-hint" style="margin-top:8px">每小時更新價格時檢查，價格跨過設定值時用 Discord 通知一次。留空表示不提醒。</div>
    ${webhookSet ? '' : '<div class="form-hint" style="margin-top:4px;color:var(--gold)">⚠️ 還沒設定 Discord Webhook，到「設定」頁填寫後才收得到通知</div>'}
    <div class="form-error" id="alert-error"></div>

    ${recent.length ? `
      <details class="history-details">
        <summary>價格紀錄（最近 ${recent.length} 筆）</summary>
        <div class="table-wrap" style="margin-top:10px">
          <table class="price-table">
            <thead><tr><th>時間</th><th class="num">台幣</th><th class="num">日幣</th><th class="num">在庫</th></tr></thead>
            <tbody>${recent.map(h => `
              <tr>
                <td class="text-sm">${new Date(h.at).toLocaleString('zh-TW')}</td>
                <td class="num">${formatTwd(twd(h.priceJpy))}</td>
                <td class="num">${h.priceJpy.toLocaleString()} 円</td>
                <td class="num">${h.stock ?? '—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>` : ''}

    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>關閉</button>
      <button class="btn-primary" type="submit" form="alert-form" id="btn-save-alert">💾 儲存提醒</button>
    </div>`);

  renderPriceChart(el.querySelector('#price-chart'), item.history || [], rate, {
    below: item.alertBelowTwd ?? null,
    above: item.alertAboveTwd ?? null,
  });

  el.querySelector('#alert-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = el.querySelector('#btn-save-alert');
    btn.disabled = true;
    try {
      await api.setWatchAlerts(item.id, Object.fromEntries(new FormData(e.target).entries()));
      close();
      showToast('已儲存價格提醒', 'success');
      await loadWatchlist();
    } catch (err) {
      el.querySelector('#alert-error').textContent = err.message;
      btn.disabled = false;
    }
  });
}
