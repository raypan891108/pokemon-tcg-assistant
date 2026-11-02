import { escHtml, formatTwd } from './utils.js';

// Line color: the site's gold, deepened to sit inside the dark-mode lightness band
// (validated against the card surface #1A1A35)
const LINE = '#B8860B';
const W = 640;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 30, left: 64 };

const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const fmtDateTime = (d) => d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

// Round tick values: 1, 2 or 5 × a power of ten, about four of them
function ticks(min, max) {
  const raw = (max - min) / 4 || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

// Single-series price line (NT$ at today's rate) with optional dashed alert thresholds,
// a crosshair + tooltip on hover/touch, and an SVG summary for screen readers
export function renderPriceChart(el, history, rate, { below = null, above = null } = {}) {
  const points = history
    .filter(h => h.priceJpy != null)
    .map(h => ({ at: new Date(h.at), jpy: h.priceJpy, twd: Math.round(h.priceJpy * rate), stock: h.stock }));

  if (points.length < 2) {
    el.innerHTML = `<div class="chart-empty">價格紀錄還不夠，至少要更新兩次才能畫出走勢（每小時自動更新一次）</div>`;
    return;
  }

  const values = points.map(p => p.twd);
  const lines = [below, above].filter(v => v != null);
  let lo = Math.min(...values, ...lines);
  let hi = Math.max(...values, ...lines);
  const pad = (hi - lo) * 0.12 || Math.max(hi * 0.05, 10);
  lo = Math.max(0, lo - pad);
  hi += pad;

  const t0 = points[0].at.getTime();
  const t1 = points[points.length - 1].at.getTime();
  const x = (d) => PAD.left + ((d.getTime() - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.twd).toFixed(1)}`).join('');
  const grid = ticks(lo, hi).map(v => `
    <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/>
    <text x="${PAD.left - 8}" y="${y(v)}" class="chart-axis" text-anchor="end" dominant-baseline="middle">${formatTwd(v)}</text>`).join('');
  const thresholds = [['below', below, '低於'], ['above', above, '高於']]
    .filter(([, v]) => v != null)
    .map(([, v, label]) => `
      <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" class="chart-threshold"/>
      <text x="${W - PAD.right}" y="${y(v) - 6}" class="chart-axis" text-anchor="end">${label} ${formatTwd(v)} 提醒</text>`).join('');

  const min = Math.min(...values);
  const max = Math.max(...values);
  el.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="price-chart" role="img"
        aria-label="${escHtml(`${points.length} 筆價格紀錄，最低 ${formatTwd(min)}，最高 ${formatTwd(max)}，目前 ${formatTwd(values[values.length - 1])}`)}">
        ${grid}
        <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${H - PAD.bottom}" y2="${H - PAD.bottom}" class="chart-baseline"/>
        <text x="${PAD.left}" y="${H - 8}" class="chart-axis">${fmtDate(points[0].at)}</text>
        <text x="${W - PAD.right}" y="${H - 8}" class="chart-axis" text-anchor="end">${fmtDate(points[points.length - 1].at)}</text>
        ${thresholds}
        <path d="${path}" fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <g class="chart-hover" visibility="hidden">
          <line class="chart-crosshair" y1="${PAD.top}" y2="${H - PAD.bottom}"/>
          <circle r="4" fill="${LINE}" stroke="var(--bg-secondary)" stroke-width="2"/>
        </g>
        <rect x="${PAD.left}" y="0" width="${W - PAD.left - PAD.right}" height="${H}" fill="transparent" class="chart-hit"/>
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>`;

  const svg = el.querySelector('svg');
  const hover = svg.querySelector('.chart-hover');
  const tip = el.querySelector('.chart-tooltip');
  const show = (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.touches ? evt.touches[0].clientX : evt.clientX) - box.left) * (W / box.width);
    const nearest = points.reduce((a, b) => (Math.abs(x(b.at) - px) < Math.abs(x(a.at) - px) ? b : a));
    const cx = x(nearest.at);
    const cy = y(nearest.twd);
    hover.setAttribute('visibility', 'visible');
    hover.querySelector('line').setAttribute('x1', cx);
    hover.querySelector('line').setAttribute('x2', cx);
    hover.querySelector('circle').setAttribute('cx', cx);
    hover.querySelector('circle').setAttribute('cy', cy);
    tip.hidden = false;
    tip.innerHTML = `<div class="text-muted">${fmtDateTime(nearest.at)}</div><strong>${formatTwd(nearest.twd)}</strong> <span class="text-muted">${nearest.jpy.toLocaleString()} 円</span>${nearest.stock != null ? `<div class="text-muted">在庫 ${nearest.stock}</div>` : ''}`;
    // Keep the tooltip inside the chart: flip to the left of the crosshair past the middle
    const left = (cx / W) * box.width;
    tip.style.left = `${left > box.width / 2 ? left - tip.offsetWidth - 12 : left + 12}px`;
    tip.style.top = `${Math.max(0, (cy / H) * box.height - tip.offsetHeight / 2)}px`;
  };
  const hide = () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const hit = svg.querySelector('.chart-hit');
  hit.addEventListener('mousemove', show);
  hit.addEventListener('touchstart', show, { passive: true });
  hit.addEventListener('touchmove', show, { passive: true });
  hit.addEventListener('mouseleave', hide);
}
