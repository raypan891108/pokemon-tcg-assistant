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
