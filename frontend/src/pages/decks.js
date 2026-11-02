import { api } from '../api.js';
import { escHtml, showToast } from '../utils.js';

const FORMAT_LABELS = {
  'standard-jp': '日本／亞洲賽制',
  standard: '國際賽制',
};

let currentFormat = 'standard-jp';

export async function renderDecks(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">🃏 牌組推薦</h1>
        <p class="page-subtitle">近 3 個月比賽中最常上位的主流牌組（資料來源：Limitless TCG）</p>
      </div>
    </div>
    <div class="page-body">
      <div class="toolbar">
        <div class="filter-tabs" id="format-tabs">
          ${Object.entries(FORMAT_LABELS).map(([k, label]) =>
            `<button class="filter-tab ${k === currentFormat ? 'active' : ''}" data-format="${k}">${label}</button>`).join('')}
        </div>
        <div class="toolbar-actions">
          <button class="btn-secondary" id="btn-refresh-decks">↻ 重新抓取</button>
        </div>
      </div>
      <p class="form-hint" style="margin:-12px 0 16px">台灣使用與日本相同的卡池與賽制，建議參考「日本／亞洲賽制」</p>
      <div id="deck-list">
        <div class="loading-spinner"><div class="spinner"></div><span>載入中...</span></div>
      </div>
    </div>`;

  document.getElementById('format-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-format]');
    if (!btn) return;
    document.querySelectorAll('#format-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentFormat = btn.dataset.format;
    loadMeta();
  });

  document.getElementById('btn-refresh-decks').addEventListener('click', () => loadMeta(true));

  document.getElementById('deck-list').addEventListener('click', e => {
    const head = e.target.closest('.deck-row-head');
    if (head) toggleDeck(head);
  });

  await loadMeta();
}

async function loadMeta(force = false) {
  const el = document.getElementById('deck-list');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>載入牌組排名...</span></div>';
  try {
    const { decks, fetchedAt, stale } = await api.decks(currentFormat, force ? 'true' : undefined);
    if (stale) showToast('暫時無法連線 Limitless，顯示上次抓取的資料', 'error');
    const maxShare = Math.max(...decks.map(d => d.share), 1);
    el.innerHTML = `
      ${decks.map(d => `
        <div class="deck-row">
          <button class="deck-row-head" data-id="${escHtml(d.id)}" aria-expanded="false">
            <span class="deck-rank">${d.rank}</span>
            <span class="deck-icons">${d.icons.map(src => `<img src="${escHtml(src)}" alt="" loading="lazy">`).join('')}</span>
            <span class="deck-name">${escHtml(d.name)}</span>
            <span class="deck-share">
              <span class="text-sm"><strong>${d.share.toFixed(2)}%</strong> <span class="text-muted">· ${d.points} 分</span></span>
              <span class="share-bar"><span style="width:${(d.share / maxShare * 100).toFixed(1)}%"></span></span>
            </span>
          </button>
          <div class="deck-detail" hidden></div>
        </div>`).join('')}
      <p class="form-hint" style="margin-top:12px">使用率依 Limitless 比賽積分計算 · 更新於 ${new Date(fetchedAt).toLocaleString('zh-TW')} · 點擊牌組可查看範例牌表</p>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入牌組資料</div><div class="empty-desc">${escHtml(err.message)}</div></div>`;
  }
}

async function toggleDeck(head) {
  const detail = head.nextElementSibling;
  const open = head.getAttribute('aria-expanded') === 'true';
  head.setAttribute('aria-expanded', String(!open));
  detail.hidden = open;
  if (open || detail.dataset.loaded) return;

  detail.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>載入範例牌表...</span></div>';
  try {
    const list = await api.deckList(head.dataset.id, currentFormat);
    detail.dataset.loaded = 'true';
    detail.innerHTML = `
      <div class="text-sm" style="margin-bottom:12px">
        範例牌表：<strong>${escHtml(list.player)}</strong> · ${escHtml(list.placing)}
        ${list.tournament ? `<span class="text-muted">（${escHtml(list.tournament)}）</span>` : ''}
        · <a href="${escHtml(list.listUrl)}" target="_blank" rel="noopener" class="text-gold">在 Limitless 查看 →</a>
      </div>
      <div class="decklist">
        ${list.sections.map(s => `
          <div>
            <h4>${escHtml(s.heading)}</h4>
            <ul>
              ${s.cards.map(c => `<li><span class="count">${c.count}</span><span>${escHtml(c.name)}</span><span class="text-muted">${escHtml(c.set)} ${escHtml(c.number)}</span></li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>`;
  } catch (err) {
    detail.innerHTML = `<div class="form-error">${escHtml(err.message)}</div>`;
  }
}
