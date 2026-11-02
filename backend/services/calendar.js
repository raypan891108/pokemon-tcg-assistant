const storage = require('./storage');

// iCalendar feed for phone calendars: tournaments, registration deadlines (with alarms)
// and product releases. Spec: RFC 5545 — CRLF line ends, lines folded at 75 octets.

const REGION_LABELS = { tw: '台灣', jp: '日本', us: '美國' };
// Past releases older than this are left out so the calendar stays short
const RELEASE_LOOKBACK_DAYS = 30;
const TOURNAMENT_HOURS = 8;

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold at 75 octets without splitting a multi-byte character (Chinese/Japanese names)
function fold(line) {
  const out = [];
  let current = '';
  for (const ch of line) {
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (Buffer.byteLength(current + ch) > limit) {
      out.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.join('\r\n ');
}

const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (s) => s.slice(0, 10).replace(/-/g, '');
const nextDay = (s) => {
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};
const hasTime = (s) => /T\d{2}:\d{2}/.test(s || '');

function event({ uid, summary, start, end, allDay, location, url, description, alarms = [] }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}@pokemon-tcg-assistant`,
    `DTSTAMP:${utcStamp(new Date())}`,
    allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
    allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
    `SUMMARY:${escapeText(summary)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (url) lines.push(`URL:${url}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  for (const { trigger, text } of alarms) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${trigger}`, `DESCRIPTION:${escapeText(text)}`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

async function buildCalendar() {
  const [tournaments, products] = await Promise.all([storage.getTournaments(), storage.getProducts()]);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pokemon TCG Assistant//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText('Pokemon TCG 助手')}`,
    'X-WR-TIMEZONE:Asia/Taipei',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const t of tournaments) {
    const region = REGION_LABELS[t.region] || '';
    if (t.date) {
      const start = new Date(t.date);
      lines.push(...event({
        uid: `tournament-${t.id}`,
        summary: `🏆 ${t.name}`,
        ...(hasTime(t.date)
          ? { start: utcStamp(start), end: utcStamp(new Date(start.getTime() + TOURNAMENT_HOURS * 3600e3)) }
          : { allDay: true, start: dateOnly(t.date), end: nextDay(t.date) }),
        location: t.location || region,
        url: t.registrationUrl || t.url,
        description: [t.description, t.url].filter(Boolean).join('\n'),
      }));
    }
    if (t.deadline) {
      const deadline = new Date(t.deadline);
      lines.push(...event({
        uid: `deadline-${t.id}`,
        summary: `⏰ 報名截止：${t.name}`,
        start: utcStamp(deadline),
        end: utcStamp(new Date(deadline.getTime() + 15 * 60e3)),
        url: t.registrationUrl || t.url,
        description: `報名網址：${t.registrationUrl || t.url || '—'}`,
        alarms: [
          { trigger: '-P1D', text: `明天報名截止：${t.name}` },
          { trigger: '-PT2H', text: `2 小時後報名截止：${t.name}` },
        ],
      }));
    }
  }

  const since = new Date(Date.now() - RELEASE_LOOKBACK_DAYS * 86400e3).toISOString().slice(0, 10);
  for (const p of products) {
    if (!p.releaseDate || p.releaseDate < since) continue;
    const region = REGION_LABELS[p.region] || '';
    lines.push(...event({
      uid: `release-${p.id}`,
      summary: `📦 ${region ? `${region}發售：` : '發售：'}${p.name}`,
      allDay: true,
      start: dateOnly(p.releaseDate),
      end: nextDay(p.releaseDate),
      url: p.url,
      description: [p.type, p.description, p.url].filter(Boolean).join('\n'),
      // All-day events start at midnight: -PT15H is 09:00 the day before
      alarms: [{ trigger: '-PT15H', text: `明天發售：${p.name}` }],
    }));
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar };
