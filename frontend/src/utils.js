// Toast notification system
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const icons = { success: '✅', error: '❌', info: '💡', loading: '⏳' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '💡'}</span><span>${message}</span>`;
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = '0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  return toast;
}

// Region labels
export const REGIONS = {
  all: '全部',
  tw: '🇹🇼 台灣',
  jp: '🇯🇵 日本',
  us: '🇺🇸 美國',
};

export function regionClass(region) {
  return `region-${region}`;
}

export function regionLabel(region) {
  return REGIONS[region] || region;
}

// Date formatting
export function formatDate(dateStr) {
  if (!dateStr) return '待公佈';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
}

export function deadlineClass(dateStr) {
  const days = daysUntil(dateStr);
  if (days === null) return '';
  if (days <= 1) return 'deadline-urgent';
  if (days <= 3) return 'deadline-soon';
  return 'deadline-ok';
}

export function deadlineText(dateStr) {
  if (!dateStr) return '待公佈';
  const d = new Date(dateStr);
  const now = new Date();
  if (d - now < 0) return '已截止';
  // Compare calendar days, so a deadline later today isn't rounded up to "tomorrow"
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOfDay(d) - startOfDay(now)) / (1000 * 60 * 60 * 24));
  if (days === 0) return '今日截止！';
  if (days === 1) return '明日截止！';
  return `還剩 ${days} 天`;
}

// Countdown timer
export function startCountdown(dateStr, el) {
  if (!dateStr || !el) return;

  function update() {
    const target = new Date(dateStr);
    const now = new Date();
    const diff = target - now;

    if (diff <= 0) {
      el.innerHTML = '<span class="text-muted">已截止</span>';
      return;
    }

    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    el.innerHTML = `
      <div class="countdown">
        ${d > 0 ? `<div class="countdown-unit"><span class="countdown-value">${d}</span><span class="countdown-label">天</span></div>` : ''}
        <div class="countdown-unit"><span class="countdown-value">${String(h).padStart(2,'0')}</span><span class="countdown-label">時</span></div>
        <div class="countdown-unit"><span class="countdown-value">${String(m).padStart(2,'0')}</span><span class="countdown-label">分</span></div>
        <div class="countdown-unit"><span class="countdown-value">${String(s).padStart(2,'0')}</span><span class="countdown-label">秒</span></div>
      </div>`;
  }

  update();
  const interval = setInterval(update, 1000);
  return interval;
}

// Escape HTML
export function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Debounce
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// Modal dialog; returns { el, close }. Closes on backdrop click or Escape.
export function openModal(html) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(backdrop);

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  backdrop.querySelector('input, select, textarea')?.focus();
  return { el: backdrop, close };
}

// NT$ amount, or an em dash when unknown
export function formatTwd(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `NT$${Math.round(n).toLocaleString('zh-TW')}`;
}

// ─── Pagination ──────────────────────────────────────────────
export const PAGE_SIZE = 20;

// One page of a list; the page number is clamped to the valid range
export function paginate(list, page, size = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(1, page), totalPages);
  return {
    items: list.slice((current - 1) * size, current * size),
    page: current,
    totalPages,
    total: list.length,
  };
}

// First, last, and the neighbours of the current page; gaps become '…'
function pageNumbers(page, totalPages) {
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return pages;
}

// Render 上一頁／頁碼／下一頁 into `el` (empty when everything fits on one page).
// onChange(newPage) runs on click, then the view scrolls back to the top.
export function renderPagination(el, { page, totalPages, total }, onChange) {
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <nav class="pagination" aria-label="分頁">
      <button class="page-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹ 上一頁</button>
      <span class="page-numbers">
        ${pageNumbers(page, totalPages).map(p => p === '…'
          ? '<span class="page-gap">…</span>'
          : `<button class="page-btn page-num ${p === page ? 'active' : ''}" data-page="${p}" ${p === page ? 'aria-current="page"' : ''}>${p}</button>`).join('')}
      </span>
      <button class="page-btn" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>下一頁 ›</button>
    </nav>
    <div class="page-info">第 ${page} / ${totalPages} 頁，共 ${total} 筆</div>`;
  // Assigned (not added) so re-rendering never stacks handlers
  el.onclick = e => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    onChange(Number(btn.dataset.page));
    document.getElementById('main-content')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };
}

// "M6a · 158/103 · SAR", skipping parts a card doesn't have
export function cardMeta(card) {
  return [card.set, card.cardNumber, card.rarity].filter(Boolean).map(escHtml).join(' · ');
}
