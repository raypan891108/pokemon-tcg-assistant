import { api } from '../api.js';
import { escHtml, showToast, openModal, formatTwd, copyText } from '../utils.js';

// 我的牌組: your own decks. Each card has the price you paid or found (typed in, optionally
// with the 卡拍拍 listing it came from) and how many you already own, so the page can add
// up what the deck costs and what's still to buy. Each deck also keeps your match results.
// Every change saves the whole deck (see backend/services/my-decks.js).

const DECK_SIZE = 60;
const KAPAIPAI_URL = 'https://trade.kapaipai.tw';
const SECTIONS = { pokemon: '寶可夢', trainer: '訓練家', energy: '能量' };
const RESULTS = { win: '勝', loss: '敗', tie: '和' };

let decks = [];
let openId = null;
let tab = 'cards';
// Set by the 牌組推薦 page when it saves a sample list, so the new deck opens straight away
let pendingOpen = null;

export function showMyDeck(id) {
  pendingOpen = id;
  location.hash = '/mydecks';
}

export async function renderMyDecks(container) {
  openId = pendingOpen;
  pendingOpen = null;
  tab = 'cards';
  container.innerHTML = `<div id="mydecks-root"><div class="loading-spinner"><div class="spinner"></div><span>載入中...</span></div></div>`;
  const root = container.querySelector('#mydecks-root');
  root.addEventListener('click', onAction);
  // Unit prices are edited right in the table: saved when the field is left, Enter goes to the next
  root.addEventListener('change', e => {
    if (e.target.matches('.price-input')) setPrice(e.target);
  });
  root.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('.price-input')) return;
    e.preventDefault();
    const inputs = [...root.querySelectorAll('.price-input')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      e.target.blur();
    }
  });

  try {
    decks = await api.myDecks();
    render();
  } catch (e) {
    root.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入牌組</div><div class="empty-desc">${escHtml(e.message)}</div></div>`;
  }
}

// ─── Totals ──────────────────────────────────────────────────
// Cards without a price count toward the card total but not the cost, and are reported apart
export function deckSummary(deck) {
  const s = { count: 0, total: 0, ownedValue: 0, toBuy: 0, missing: 0, unpriced: 0 };
  for (const c of deck.cards) {
    const owned = Math.min(c.owned || 0, c.quantity);
    s.count += c.quantity;
    s.missing += c.quantity - owned;
    if (c.price == null) {
      s.unpriced += c.quantity;
      continue;
    }
    s.total += c.quantity * c.price;
    s.ownedValue += owned * c.price;
    s.toBuy += (c.quantity - owned) * c.price;
  }
  return s;
}

export function deckRecord(deck) {
  const r = { win: 0, loss: 0, tie: 0 };
  for (const m of deck.matches) r[m.result]++;
  const games = r.win + r.loss + r.tie;
  return { ...r, games, winRate: games ? r.win / games : null };
}

const recordText = r => (r.games ? `${r.win} 勝 ${r.loss} 敗${r.tie ? ` ${r.tie} 和` : ''}` : '還沒有紀錄');
const percent = n => (n == null ? '—' : `${Math.round(n * 100)}%`);

function countText(count) {
  if (count === DECK_SIZE) return '剛好 60 張';
  if (count < DECK_SIZE) return `還差 ${DECK_SIZE - count} 張`;
  return `多了 ${count - DECK_SIZE} 張`;
}

// ─── Rendering ───────────────────────────────────────────────
function render() {
  const deck = decks.find(d => d.id === openId);
  if (deck) renderDeck(deck);
  else renderList();
}

function renderList() {
  openId = null;
  document.getElementById('mydecks-root').innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">🗂️ 我的牌組</h1>
        <p class="page-subtitle">自己組的牌、成本和比賽紀錄</p>
      </div>
      <div class="toolbar-actions">
        <button class="btn-secondary" data-action="deck-import">📥 代碼匯入</button>
        <button class="btn-primary" data-action="deck-add">＋ 新增牌組</button>
      </div>
    </div>
    <div class="page-body">
      ${decks.length ? `
        <div class="my-deck-grid">
          ${decks.map(deckCard).join('')}
        </div>` : `
        <div class="empty-state">
          <div class="empty-icon">🗂️</div>
          <div class="empty-title">還沒有牌組</div>
          <div class="empty-desc">按「📥 代碼匯入」貼上 PTCGTW 牌組代碼、按「＋ 新增牌組」自己組，或到「🃏 牌組推薦」打開範例牌表，按「📥 存成我的牌組」</div>
        </div>`}
      <p class="form-hint" style="margin-top:16px">價格請自己填：在卡拍拍找到那張卡，貼上網址和價格，系統會算出整副牌的成本和還要花多少</p>
    </div>`;
}

function deckCard(deck) {
  const s = deckSummary(deck);
  const r = deckRecord(deck);
  return `
    <button type="button" class="my-deck-card" data-action="deck-open" data-deck="${deck.id}">
      <span class="my-deck-name">${escHtml(deck.name)}</span>
      <span class="my-deck-meta">
        <span class="${s.count === DECK_SIZE ? '' : 'text-muted'}">${s.count} / ${DECK_SIZE} 張</span>
        <span>成本 <strong class="text-gold">${formatTwd(s.total)}</strong>${s.unpriced ? `<span class="text-muted">（${s.unpriced} 張未填價格）</span>` : ''}</span>
        ${s.toBuy ? `<span>還要花 ${formatTwd(s.toBuy)}</span>` : ''}
        <span>${recordText(r)}${r.games ? ` · 勝率 ${percent(r.winRate)}` : ''}</span>
      </span>
    </button>`;
}

function statsHtml(deck) {
  const s = deckSummary(deck);
  const r = deckRecord(deck);
  return `
    <div class="stat-card">
      <div class="stat-icon">🃏</div>
      <div class="stat-value">${s.count}<span class="stat-of"> / ${DECK_SIZE}</span></div>
      <div class="stat-label">張數</div>
      <div class="stat-sub">${countText(s.count)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">💰</div>
      <div class="stat-value">${formatTwd(s.total)}</div>
      <div class="stat-label">整副成本</div>
      <div class="stat-sub">${s.unpriced ? `${s.unpriced} 張還沒填價格，沒算進去` : s.count ? '每張都有價格' : '加入卡片後計算'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">🛒</div>
      <div class="stat-value">${formatTwd(s.toBuy)}</div>
      <div class="stat-label">還要花</div>
      <div class="stat-sub">缺 ${s.missing} 張 · 已擁有的值 ${formatTwd(s.ownedValue)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">🏆</div>
      <div class="stat-value">${percent(r.winRate)}</div>
      <div class="stat-label">勝率</div>
      <div class="stat-sub">${r.games ? `${r.games} 場 · ${recordText(r)}` : '還沒有比賽紀錄'}</div>
    </div>`;
}

function renderDeck(deck) {
  document.getElementById('mydecks-root').innerHTML = `
    <div class="page-header">
      <div>
        <button type="button" class="back-link" data-action="back">← 我的牌組</button>
        <h1 class="page-title">${escHtml(deck.name)}</h1>
        ${deck.notes ? `<p class="page-subtitle">${escHtml(deck.notes)}</p>` : ''}
      </div>
      <div class="toolbar-actions">
        <button class="btn-secondary" data-action="deck-edit">✏️ 名稱與備註</button>
        <button class="btn-secondary" data-action="deck-delete" aria-label="刪除牌組">🗑️</button>
      </div>
    </div>
    <div class="page-body">
      <div class="stats-grid my-deck-stats" id="deck-stats">${statsHtml(deck)}</div>
      <div class="toolbar">
        <div class="filter-tabs">
          <button class="filter-tab ${tab === 'cards' ? 'active' : ''}" data-action="tab" data-tab="cards">牌表</button>
          <button class="filter-tab ${tab === 'matches' ? 'active' : ''}" data-action="tab" data-tab="matches">比賽紀錄 ${deck.matches.length}</button>
        </div>
        <div class="toolbar-actions">
          ${tab === 'cards'
            ? `<button class="btn-secondary" data-action="card-from-inventory">📦 從倉庫加入</button>
               <button class="btn-primary" data-action="card-add">＋ 新增卡片</button>`
            : '<button class="btn-primary" data-action="match-add">＋ 新增紀錄</button>'}
        </div>
      </div>
      ${tab === 'cards' ? cardsHtml(deck) : matchesHtml(deck)}
    </div>`;
}

function cardsHtml(deck) {
  if (!deck.cards.length) {
    return `<div class="empty-state"><div class="empty-icon">🃏</div><div class="empty-title">牌表是空的</div><div class="empty-desc">按「＋ 新增卡片」加入卡片，或「📦 從倉庫加入」挑手上的卡</div></div>`;
  }
  return `
    <p class="form-hint" style="margin:-8px 0 14px">單價可以直接在表格裡改，按 Enter 跳到下一張。「🔎 卡拍拍」會複製卡名並打開卡拍拍，貼上就能搜尋。</p>
    ${Object.entries(SECTIONS).map(([key, label]) => {
    const cards = deck.cards.filter(c => c.section === key);
    if (!cards.length) return '';
    return `
      <section class="my-deck-section">
        <h2 class="my-deck-section-title">${label} <span class="text-muted" data-section-total="${key}">${sectionTotal(cards)}</span></h2>
        <div class="table-wrap">
          <table class="price-table">
            <thead>
              <tr>
                <th class="num">張數</th>
                <th>卡片</th>
                <th class="num">已擁有</th>
                <th class="num">單價</th>
                <th class="num">小計</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${cards.map(cardRow).join('')}</tbody>
          </table>
        </div>
      </section>`;
  }).join('')}`;
}

function sectionTotal(cards) {
  const count = cards.reduce((n, c) => n + c.quantity, 0);
  const subtotal = cards.reduce((n, c) => n + (c.price == null ? 0 : c.price * c.quantity), 0);
  return `${count} 張 · ${formatTwd(subtotal)}`;
}

const subtotalHtml = c => (c.price == null ? '<span class="text-muted">—</span>' : formatTwd(c.price * c.quantity));

function cardRow(c) {
  const owned = Math.min(c.owned || 0, c.quantity);
  return `
    <tr>
      <td class="num"><strong class="text-gold">${c.quantity}</strong></td>
      <td class="wrap"><strong>${escHtml(c.name)}</strong>${c.print ? `<br><span class="text-muted text-sm">${escHtml(c.print)}</span>` : ''}</td>
      <td class="num"><span class="${owned === c.quantity ? 'profit-pos' : 'text-muted'}">${owned} / ${c.quantity}</span></td>
      <td class="num">
        <input type="number" class="form-input price-input" data-card="${c.id}" min="0" step="any" inputmode="decimal"
          value="${c.price ?? ''}" placeholder="填價格" aria-label="${escHtml(c.name)} 的單價（NT$）" />
      </td>
      <td class="num" data-subtotal="${c.id}">${subtotalHtml(c)}</td>
      <td>
        <div class="row-actions">
          <button class="btn-secondary btn-sm" data-action="card-kapaipai" data-card="${c.id}" title="複製卡名並打開卡拍拍">🔎 卡拍拍</button>
          ${c.url ? `<a class="btn-secondary btn-sm" href="${escHtml(c.url)}" target="_blank" rel="noopener noreferrer" title="打開價格來源">🔗 來源</a>` : ''}
          <button class="btn-secondary btn-sm" data-action="card-edit" data-card="${c.id}">編輯</button>
          <button class="btn-secondary btn-sm" data-action="card-delete" data-card="${c.id}" aria-label="刪除">🗑</button>
        </div>
      </td>
    </tr>`;
}

function matchesHtml(deck) {
  if (!deck.matches.length) {
    return `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-title">還沒有比賽紀錄</div><div class="empty-desc">每打完一場，按「＋ 新增紀錄」記下結果</div></div>`;
  }
  // Newest first; same-day matches keep the order they were entered
  const sorted = deck.matches.map((m, i) => ({ m, i })).sort((a, b) => b.m.date.localeCompare(a.m.date) || b.i - a.i).map(x => x.m);
  return `
    <div class="table-wrap">
      <table class="price-table">
        <thead>
          <tr><th>日期</th><th>比賽</th><th>對手牌組</th><th>結果</th><th>備註</th><th></th></tr>
        </thead>
        <tbody>
          ${sorted.map(m => `
            <tr>
              <td>${escHtml(m.date)}</td>
              <td class="wrap">${escHtml(m.event) || '<span class="text-muted">—</span>'}</td>
              <td class="wrap">${escHtml(m.opponent) || '<span class="text-muted">—</span>'}</td>
              <td><span class="result-pill result-${m.result}">${RESULTS[m.result]}</span></td>
              <td class="wrap text-sm">${escHtml(m.notes)}</td>
              <td>
                <div class="row-actions">
                  <button class="btn-secondary btn-sm" data-action="match-edit" data-match="${m.id}">編輯</button>
                  <button class="btn-secondary btn-sm" data-action="match-delete" data-match="${m.id}" aria-label="刪除">🗑</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ─── Saving ──────────────────────────────────────────────────
// The server's copy (cleaned up, with ids) replaces ours
async function saveDeck(deck, message) {
  try {
    const saved = await api.saveMyDeck(deck.id, deck);
    decks = decks.map(d => (d.id === saved.id ? saved : d));
    render();
    if (message) showToast(message, 'success');
    return true;
  } catch (e) {
    showToast(`儲存失敗：${escHtml(e.message)}`, 'error');
    return false;
  }
}

const current = () => structuredClone(decks.find(d => d.id === openId));

// Price edits save one after another, each sending the deck as it was right after that edit,
// so quickly tabbing through several prices can't let an older save overwrite a newer one.
// Only the totals are redrawn, so the field you moved to keeps its focus.
let priceSaves = Promise.resolve();

function setPrice(input) {
  const deck = decks.find(d => d.id === openId);
  const card = deck?.cards.find(c => c.id === input.dataset.card);
  if (!card) return;
  const raw = input.value.trim();
  const price = raw === '' ? null : Number(raw);
  if (input.validity.badInput || (price != null && !(price >= 0))) {
    showToast('價格需為 0 以上的數字', 'error');
    input.value = card.price ?? '';
    return;
  }
  if (price === card.price) return;
  card.price = price;
  refreshTotals(deck, card);

  const snapshot = structuredClone(deck);
  priceSaves = priceSaves
    .then(() => api.saveMyDeck(snapshot.id, snapshot))
    .catch(async err => {
      showToast(`價格沒有存到：${escHtml(err.message)}`, 'error');
      // Show what the server actually has
      decks = await api.myDecks().catch(() => decks);
      render();
    });
}

function refreshTotals(deck, card) {
  document.getElementById('deck-stats').innerHTML = statsHtml(deck);
  const subtotal = document.querySelector(`[data-subtotal="${card.id}"]`);
  if (subtotal) subtotal.innerHTML = subtotalHtml(card);
  const section = document.querySelector(`[data-section-total="${card.section}"]`);
  if (section) section.textContent = sectionTotal(deck.cards.filter(c => c.section === card.section));
}


// You search 卡拍拍 yourself: this only copies the card name and opens the site, in the
// same tab each time. Nothing is read from 卡拍拍 (its terms forbid automated access).
function searchKapaipai(card) {
  const copied = copyText(card.name);
  if (!copied) navigator.clipboard?.writeText(card.name).catch(() => {});
  const tab = window.open(KAPAIPAI_URL, 'kapaipai');
  if (tab) tab.opener = null;
  showToast(`已複製「${escHtml(card.name)}」，到卡拍拍的搜尋欄貼上`, 'success');
}

function onAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action } = btn.dataset;
  const deck = openId && current();

  switch (action) {
    case 'deck-add':
      openDeckForm();
      break;
    case 'deck-import':
      openImportForm();
      break;
    case 'deck-open':
      openId = btn.dataset.deck;
      tab = 'cards';
      render();
      window.scrollTo({ top: 0 });
      document.getElementById('main-content')?.scrollTo({ top: 0 });
      break;
    case 'back':
      openId = null;
      render();
      break;
    case 'deck-edit':
      openDeckForm(deck);
      break;
    case 'deck-delete':
      deleteDeck(deck);
      break;
    case 'tab':
      tab = btn.dataset.tab;
      render();
      break;
    case 'card-add':
      openCardForm(deck);
      break;
    case 'card-kapaipai':
      searchKapaipai(deck.cards.find(c => c.id === btn.dataset.card));
      break;
    case 'card-edit':
      openCardForm(deck, deck.cards.find(c => c.id === btn.dataset.card));
      break;
    case 'card-delete': {
      const card = deck.cards.find(c => c.id === btn.dataset.card);
      if (!confirm(`要從牌表移除「${card.name}」嗎？`)) break;
      deck.cards = deck.cards.filter(c => c.id !== card.id);
      saveDeck(deck, '已移除');
      break;
    }
    case 'card-from-inventory':
      openInventoryPicker(deck);
      break;
    case 'match-add':
      openMatchForm(deck);
      break;
    case 'match-edit':
      openMatchForm(deck, deck.matches.find(m => m.id === btn.dataset.match));
      break;
    case 'match-delete': {
      if (!confirm('要刪除這筆比賽紀錄嗎？')) break;
      deck.matches = deck.matches.filter(m => m.id !== btn.dataset.match);
      saveDeck(deck, '已刪除');
      break;
    }
  }
}

async function deleteDeck(deck) {
  const extra = deck.matches.length ? `，連同 ${deck.matches.length} 筆比賽紀錄` : '';
  if (!confirm(`要刪除牌組「${deck.name}」嗎${extra}？刪除後無法復原。`)) return;
  try {
    await api.deleteMyDeck(deck.id);
    decks = decks.filter(d => d.id !== deck.id);
    openId = null;
    render();
    showToast('已刪除牌組', 'success');
  } catch (e) {
    showToast(`刪除失敗：${escHtml(e.message)}`, 'error');
  }
}

// ─── Forms ───────────────────────────────────────────────────
function openDeckForm(deck = null) {
  const { el, close } = openModal(`
    <div class="modal-title">${deck ? '名稱與備註' : '新增牌組'}</div>
    <form id="deck-form">
      <div class="form-group">
        <label class="form-label" for="deck-name">牌組名稱</label>
        <input id="deck-name" name="name" class="form-input" required maxlength="60" placeholder="例如：沙奈朵ex" value="${escHtml(deck?.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="deck-notes">備註（選填）</label>
        <textarea id="deck-notes" name="notes" class="form-input" maxlength="500" rows="3">${escHtml(deck?.notes || '')}</textarea>
      </div>
    </form>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="deck-form">💾 儲存</button>
    </div>`);

  el.querySelector('#deck-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (deck) {
      if (await saveDeck({ ...deck, name: f.get('name'), notes: f.get('notes') }, '已更新')) close();
      return;
    }
    try {
      const created = await api.createMyDeck({ name: f.get('name'), notes: f.get('notes'), cards: [], matches: [] });
      decks = [created, ...decks];
      openId = created.id;
      tab = 'cards';
      render();
      close();
      showToast('已新增牌組', 'success');
    } catch (err) {
      showToast(`新增失敗：${escHtml(err.message)}`, 'error');
    }
  });
}

// A deck shared on PTCGTW, by the code printed under its deck image (e.g. CQ94394)
function openImportForm() {
  const { el, close } = openModal(`
    <div class="modal-title">從 PTCGTW 代碼匯入</div>
    <form id="import-form">
      <div class="form-group">
        <label class="form-label" for="import-code">牌組代碼或連結</label>
        <input id="import-code" name="code" class="form-input" required maxlength="200" autocomplete="off" placeholder="例如：CQ94394" />
        <div class="form-hint">牌組圖片下方「點擊圖片開啟 PTCGTW 牌組頁：CQ94394」的那串代碼，或 PTCGTW 牌組頁的網址</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="import-name">牌組名稱（選填）</label>
        <input id="import-name" name="name" class="form-input" maxlength="60" placeholder="留空會用主要的寶可夢命名" />
      </div>
      <p class="form-hint">價格會先填 Kiwi PTCG 的售價，是組牌者選的版本（例如 SAR），可以再改成卡拍拍或自己買到的價格。</p>
    </form>
    <div class="form-error" id="import-error"></div>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="import-form" id="import-submit">📥 匯入</button>
    </div>`);

  el.querySelector('#import-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const submit = el.querySelector('#import-submit');
    const error = el.querySelector('#import-error');
    submit.disabled = true;
    submit.textContent = '匯入中...';
    error.textContent = '';
    try {
      const created = await api.importMyDeck(f.get('code'), f.get('name'));
      decks = [created, ...decks];
      openId = created.id;
      tab = 'cards';
      render();
      close();
      showToast(`已匯入「${escHtml(created.name)}」`, 'success');
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
      submit.textContent = '📥 匯入';
    }
  });
}

function openCardForm(deck, card = null) {
  const { el, close } = openModal(`
    <div class="modal-title">${card ? '編輯卡片' : '新增卡片'}</div>
    <form id="card-form">
      <div class="form-grid">
        <div class="form-group span-2">
          <label class="form-label" for="card-name">卡名</label>
          <input id="card-name" name="name" class="form-input" required maxlength="80" placeholder="例如：沙奈朵ex" value="${escHtml(card?.name || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="card-section">種類</label>
          <select id="card-section" name="section" class="form-input">
            ${Object.entries(SECTIONS).map(([k, label]) => `<option value="${k}" ${(card?.section || 'pokemon') === k ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="card-print">編號（選填）</label>
          <input id="card-print" name="print" class="form-input" maxlength="40" placeholder="例如：SV1a 038" value="${escHtml(card?.print || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="card-quantity">張數</label>
          <input id="card-quantity" name="quantity" type="number" class="form-input" required min="1" max="60" step="1" value="${card?.quantity ?? 1}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="card-owned">已經有幾張</label>
          <input id="card-owned" name="owned" type="number" class="form-input" required min="0" max="60" step="1" value="${card?.owned ?? 0}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="card-price">單價（NT$）</label>
          <input id="card-price" name="price" type="number" class="form-input" min="0" step="any" placeholder="還不知道可留空" value="${card?.price ?? ''}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="card-url">價格來源網址（選填）</label>
          <input id="card-url" name="url" type="url" class="form-input" placeholder="卡拍拍商品網址" value="${escHtml(card?.url || '')}" />
        </div>
      </div>
      <p class="form-hint" style="margin-top:12px">到 <a href="${KAPAIPAI_URL}" target="_blank" rel="noopener noreferrer" class="text-gold">卡拍拍 ↗</a> 找到這張卡，把價格填在「單價」，網址貼在「價格來源」，之後可以一鍵打開回去看。</p>
    </form>
    <div class="form-error" id="card-error"></div>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="card-form">💾 儲存</button>
    </div>`);

  // 已經有幾張 can't be more than 張數
  const quantity = el.querySelector('#card-quantity');
  const owned = el.querySelector('#card-owned');
  const syncOwnedMax = () => { owned.max = quantity.value || 60; };
  quantity.addEventListener('input', syncOwnedMax);
  syncOwnedMax();

  el.querySelector('#card-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const entry = {
      ...card,
      name: f.get('name'),
      section: f.get('section'),
      print: f.get('print'),
      quantity: Number(f.get('quantity')),
      owned: Number(f.get('owned')),
      price: f.get('price') === '' ? null : Number(f.get('price')),
      url: f.get('url'),
    };
    deck.cards = card ? deck.cards.map(c => (c.id === card.id ? entry : c)) : [...deck.cards, entry];
    if (await saveDeck(deck, card ? '已更新' : '已加入')) close();
    else el.querySelector('#card-error').textContent = '儲存失敗，請檢查欄位';
  });
}

// Cards from 賣場倉庫 that aren't sold: name, number and what you paid come along
async function openInventoryPicker(deck) {
  let items;
  try {
    items = (await api.inventory()).filter(i => i.status !== 'sold' && (!i.itemType || i.itemType === 'card'));
  } catch (e) {
    showToast(`無法載入倉庫：${escHtml(e.message)}`, 'error');
    return;
  }
  if (!items.length) {
    showToast('倉庫裡沒有未售出的卡', 'error');
    return;
  }
  const inDeck = new Set(deck.cards.map(c => c.inventoryId).filter(Boolean));
  const { el, close } = openModal(`
    <div class="modal-title">從倉庫加入</div>
    <p class="form-hint" style="margin-bottom:12px">勾選要放進牌組的卡，單價會用倉庫記錄的成本，也會算成已擁有</p>
    <form id="inventory-pick" class="inventory-pick">
      ${items.map(i => `
        <label class="inventory-pick-row ${inDeck.has(i.id) ? 'is-in-deck' : ''}">
          <input type="checkbox" name="pick" value="${i.id}" ${inDeck.has(i.id) ? 'disabled' : ''} />
          <span class="inventory-pick-name">
            <strong>${escHtml(i.name)}</strong>
            <span class="text-muted text-sm">${escHtml([i.set, i.cardNumber].filter(Boolean).join(' ') || '')} · 有 ${i.quantity} 張 · 成本 ${formatTwd(i.cost)}${inDeck.has(i.id) ? ' · 已在牌組裡' : ''}</span>
          </span>
          <input type="number" class="form-input inventory-pick-qty" name="qty-${i.id}" min="1" max="60" step="1" value="${Math.min(i.quantity, 4)}" aria-label="放幾張" ${inDeck.has(i.id) ? 'disabled' : ''} />
        </label>`).join('')}
    </form>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="inventory-pick">＋ 加入</button>
    </div>`);

  el.querySelector('#inventory-pick').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const picked = f.getAll('pick').map(id => items.find(i => i.id === id));
    if (!picked.length) {
      showToast('請先勾選卡片', 'error');
      return;
    }
    deck.cards = [...deck.cards, ...picked.map(i => {
      const quantity = Math.min(Math.max(Number(f.get(`qty-${i.id}`)) || 1, 1), 60);
      return {
        name: i.name,
        section: /能量|energy/i.test(i.name) ? 'energy' : 'pokemon',
        print: [i.set, i.cardNumber].filter(Boolean).join(' '),
        quantity,
        owned: Math.min(i.quantity, quantity),
        price: i.cost ?? null,
        url: '',
        inventoryId: i.id,
      };
    })];
    if (await saveDeck(deck, `已加入 ${picked.length} 張卡`)) close();
  });
}

function openMatchForm(deck, match = null) {
  const today = new Date().toLocaleDateString('sv-SE');
  // Earlier entries as suggestions, so the same event or opponent is typed the same way
  const unique = key => [...new Set(deck.matches.map(m => m[key]).filter(Boolean))];
  const { el, close } = openModal(`
    <div class="modal-title">${match ? '編輯比賽紀錄' : '新增比賽紀錄'}</div>
    <form id="match-form">
      <div class="form-group">
        <span class="form-label">結果</span>
        <div class="result-choice">
          ${Object.entries(RESULTS).map(([k, label]) => `
            <label class="result-option result-${k}">
              <input type="radio" name="result" value="${k}" required ${(match?.result || 'win') === k ? 'checked' : ''} />
              <span>${label}</span>
            </label>`).join('')}
        </div>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label" for="match-date">日期</label>
          <input id="match-date" name="date" type="date" class="form-input" required value="${escHtml(match?.date || today)}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="match-event">比賽（選填）</label>
          <input id="match-event" name="event" class="form-input" maxlength="80" list="match-events" placeholder="例如：店家賽" value="${escHtml(match?.event || '')}" />
          <datalist id="match-events">${unique('event').map(v => `<option value="${escHtml(v)}">`).join('')}</datalist>
        </div>
        <div class="form-group span-2">
          <label class="form-label" for="match-opponent">對手牌組（選填）</label>
          <input id="match-opponent" name="opponent" class="form-input" maxlength="80" list="match-opponents" placeholder="例如：古劍豹ex" value="${escHtml(match?.opponent || '')}" />
          <datalist id="match-opponents">${unique('opponent').map(v => `<option value="${escHtml(v)}">`).join('')}</datalist>
        </div>
        <div class="form-group span-2">
          <label class="form-label" for="match-notes">備註（選填）</label>
          <input id="match-notes" name="notes" class="form-input" maxlength="300" placeholder="例如：先攻、卡手" value="${escHtml(match?.notes || '')}" />
        </div>
      </div>
    </form>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close>取消</button>
      <button class="btn-primary" type="submit" form="match-form">💾 儲存</button>
    </div>`);

  el.querySelector('#match-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const entry = { ...match, date: f.get('date'), event: f.get('event'), opponent: f.get('opponent'), result: f.get('result'), notes: f.get('notes') };
    deck.matches = match ? deck.matches.map(m => (m.id === match.id ? entry : m)) : [...deck.matches, entry];
    if (await saveDeck(deck, match ? '已更新' : '已記錄')) close();
  });
}
