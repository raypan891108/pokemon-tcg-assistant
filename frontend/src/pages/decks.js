import { api } from '../api.js';
import { escHtml, showToast } from '../utils.js';

const FORMAT_LABELS = {
  'standard-jp': '日本／亞洲賽制',
  standard: '國際賽制',
};

const LANG_LABELS = { zh: '中文', ja: '日本語', en: 'English' };
const LANG_KEY = 'decks-lang';
const HEADINGS = {
  zh: { 'Pokémon': '寶可夢', Trainer: '訓練家', Energy: '能量' },
  ja: { 'Pokémon': 'ポケモン', Trainer: 'トレーナーズ', Energy: 'エネルギー' },
};

let currentFormat = 'standard-jp';
let lang = readLang();
let meta = null;
// Decklists already loaded, by deck id, so switching language doesn't refetch
const lists = new Map();

function readLang() {
  try {
    return LANG_LABELS[localStorage.getItem(LANG_KEY)] ? localStorage.getItem(LANG_KEY) : 'zh';
  } catch {
    return 'zh';
  }
}

function saveLang(value) {
  try {
    localStorage.setItem(LANG_KEY, value);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered
  }
}

export async function renderDecks(container) {
  lists.clear();
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
        <div class="filter-tabs" id="lang-tabs" aria-label="卡名語言">
          ${Object.entries(LANG_LABELS).map(([k, label]) =>
            `<button class="filter-tab ${k === lang ? 'active' : ''}" data-lang="${k}">${label}</button>`).join('')}
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
    lists.clear();
    loadMeta();
  });

  document.getElementById('lang-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    document.querySelectorAll('#lang-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    lang = btn.dataset.lang;
    saveLang(lang);
    renderMeta();
  });

  document.getElementById('btn-refresh-decks').addEventListener('click', () => {
    lists.clear();
    loadMeta(true);
  });

  document.getElementById('deck-list').addEventListener('click', e => {
    const head = e.target.closest('.deck-row-head');
    if (head) toggleDeck(head);
  });

  await loadMeta();
}

const deckName = (d) => (lang === 'zh' && d.nameZh) || (lang === 'ja' && d.nameJa) || d.name;
// Trainer and energy cards have no Chinese name: fall back to Japanese
const cardName = (c) => (lang === 'zh' && (c.nameZh || c.nameJa)) || (lang === 'ja' && c.nameJa) || c.name;
// Chinese/Japanese modes show the Japanese print, which matches the Asian release
const cardPrint = (c) => (lang !== 'en' && c.jaSet ? `${c.jaSet} ${c.jaNumber}` : `${c.set} ${c.number}`);
function heading(text) {
  const [word, ...rest] = text.split(' ');
  return [HEADINGS[lang]?.[word] || word, ...rest].join(' ');
}

async function loadMeta(force = false) {
  const el = document.getElementById('deck-list');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>載入牌組排名...</span></div>';
  try {
    meta = await api.decks(currentFormat, force ? 'true' : undefined);
    if (meta.stale) showToast('暫時無法連線 Limitless，顯示上次抓取的資料', 'error');
    renderMeta();
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入牌組資料</div><div class="empty-desc">${escHtml(err.message)}</div></div>`;
  }
}

// Redrawn on language change; decks that were open stay open
function renderMeta() {
  const el = document.getElementById('deck-list');
  if (!el || !meta) return;
  const open = new Set([...el.querySelectorAll('.deck-row-head[aria-expanded="true"]')].map(h => h.dataset.id));
  const maxShare = Math.max(...meta.decks.map(d => d.share), 1);
  el.innerHTML = `
    ${meta.decks.map(d => {
      const name = deckName(d);
      return `
        <div class="deck-row">
          <button class="deck-row-head" data-id="${escHtml(d.id)}" aria-expanded="${open.has(d.id)}">
            <span class="deck-rank">${d.rank}</span>
            <span class="deck-icons">${d.icons.map(src => `<img src="${escHtml(src)}" alt="" loading="lazy">`).join('')}</span>
            <span class="deck-name">${escHtml(name)}${name !== d.name ? `<br><span class="text-muted text-sm">${escHtml(d.name)}</span>` : ''}</span>
            <span class="deck-share">
              <span class="text-sm"><strong>${d.share.toFixed(2)}%</strong> <span class="text-muted">· ${d.points} 分</span></span>
              <span class="share-bar"><span style="width:${(d.share / maxShare * 100).toFixed(1)}%"></span></span>
            </span>
          </button>
          <div class="deck-detail" ${open.has(d.id) ? '' : 'hidden'}>${lists.has(d.id) ? listHtml(lists.get(d.id)) : ''}</div>
        </div>`;
    }).join('')}
    <p class="form-hint" style="margin-top:12px">使用率依 Limitless 比賽積分計算 · 更新於 ${new Date(meta.fetchedAt).toLocaleString('zh-TW')} · 點擊牌組可查看範例牌表</p>`;
}

function listHtml(list) {
  return `
    <div class="text-sm" style="margin-bottom:12px">
      範例牌表：<strong>${escHtml(list.player)}</strong> · ${escHtml(list.placing)}
      ${list.tournament ? `<span class="text-muted">（${escHtml(list.tournament)}）</span>` : ''}
      · <a href="${escHtml(list.listUrl)}" target="_blank" rel="noopener" class="text-gold">在 Limitless 查看 →</a>
    </div>
    ${lang === 'zh' ? '<p class="form-hint" style="margin:-4px 0 12px">寶可夢顯示中文名稱；訓練家卡和能量卡沒有可靠的中文資料，顯示日文名稱。編號是日本版，可以直接用在卡牌市場的搜尋（例如 M2a_132）。</p>' : ''}
    <div class="decklist">
      ${list.sections.map(s => `
        <div>
          <h4>${escHtml(heading(s.heading))}</h4>
          <ul>
            ${s.cards.map(c => `
              <li title="${escHtml(c.name)}">
                <span class="count">${c.count}</span>
                <span>${escHtml(cardName(c))}</span>
                <span class="text-muted">${escHtml(cardPrint(c))}</span>
              </li>`).join('')}
          </ul>
        </div>`).join('')}
    </div>`;
}

async function toggleDeck(head) {
  const detail = head.nextElementSibling;
  const open = head.getAttribute('aria-expanded') === 'true';
  head.setAttribute('aria-expanded', String(!open));
  detail.hidden = open;
  const id = head.dataset.id;
  if (open || lists.has(id)) return;

  detail.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>載入範例牌表...</span></div>';
  try {
    const list = await api.deckList(id, currentFormat);
    lists.set(id, list);
    detail.innerHTML = listHtml(list);
  } catch (err) {
    detail.innerHTML = `<div class="form-error">${escHtml(err.message)}</div>`;
  }
}
