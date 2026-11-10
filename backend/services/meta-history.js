const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const decks = require('./decks');
const names = require('./card-names');
const cityLeague = require('./city-league');

// One snapshot of the meta a day, and what changed since the previous one, for the PTCG
// advisor (a Claude scheduled task that reads these files and writes notes; see README).
//
//   meta-history/2026-11-10.json     the snapshot: Limitless deck rankings, the top decks'
//                                    sample lists, and which City Leagues had been collected
//   meta-history/2026-11-10.diff.md  what changed since the last snapshot, in Chinese
//   meta-history/city-league.json    Japanese City League results (see city-league.js)
//
// Taken after the first fetch of the day. A day Limitless can't be reached is retried on the
// next hourly fetch, so a snapshot never holds stale data.

const DIR = path.join(storage.dataDir, 'meta-history');
const KEEP_DAYS = 180;
// Sample lists are fetched for this many of the top Japanese-format decks
const TOP_LISTS = 8;
// Pause between Limitless page loads, to go easy on the site
const PAUSE_MS = 1000;

// Limitless's Japanese ranking only counts its larger events, so it moves slowly; the City
// League sections are where week-to-week changes show
const VIEWS = [
  { key: 'standard-jp/3months', label: '日本／亞洲賽制：Limitless 近 3 個月排名' },
  { key: 'standard/3months', label: '國際賽制：Limitless 近 3 個月排名', top: 15 },
];
const SECTION_LABELS = { pokemon: '寶可夢', trainer: '訓練家', energy: '能量' };

const today = () => new Date().toLocaleDateString('sv-SE');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fileFor = (date, ext) => path.join(DIR, `${date}${ext}`);

async function listDates() {
  try {
    return (await fs.promises.readdir(DIR))
      .map(n => n.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
      .filter(Boolean)
      .sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

const slimDeck = d => ({ id: d.id, rank: d.rank, name: d.name, nameZh: d.nameZh || null, share: d.share, points: d.points });

function sectionOf(heading) {
  if (/^Pok/i.test(heading)) return 'pokemon';
  if (/^Energy/i.test(heading)) return 'energy';
  return 'trainer';
}

function slimList(deck, list) {
  return {
    name: deck.name,
    nameZh: deck.nameZh || null,
    player: list.player,
    placing: list.placing,
    tournament: list.tournament,
    listUrl: list.listUrl,
    cards: list.sections.flatMap(s => s.cards.map(c => ({
      section: sectionOf(s.heading),
      name: c.name,
      nameZh: c.nameZh || null,
      nameJa: c.nameJa || null,
      count: c.count,
    }))),
  };
}

async function buildSnapshot(date) {
  const jp3 = await decks.getMeta('standard-jp', true);
  if (jp3.stale) throw new Error('Limitless 暫時連不上');
  await sleep(PAUSE_MS);
  const intl = await decks.getMeta('standard', true);
  if (intl.stale) throw new Error('Limitless 暫時連不上');

  const lists = {};
  for (const deck of jp3.decks.slice(0, TOP_LISTS)) {
    await sleep(PAUSE_MS);
    try {
      const list = await decks.getSampleList(deck.id, 'standard-jp');
      if (!list.stale) lists[deck.id] = slimList(deck, list);
    } catch (e) {
      console.error(`[MetaHistory] Sample list ${deck.id}:`, e.message);
    }
  }

  return {
    date,
    takenAt: new Date().toISOString(),
    source: 'Limitless TCG (limitlesstcg.com)',
    meta: {
      'standard-jp/3months': jp3.decks.map(slimDeck),
      'standard/3months': intl.decks.map(slimDeck),
    },
    lists,
    // Which City Leagues had been collected, so the next snapshot can tell what's new
    cityLeagueIds: Object.keys((await cityLeague.load()).tournaments),
  };
}

// ─── Diff ────────────────────────────────────────────────────
const deckLabel = d => (d.nameZh && d.nameZh !== d.name ? `${d.nameZh}（${d.name}）` : d.name);
const signed = (n, digits = 2) => (n > 0 ? `+${n.toFixed(digits)}` : n.toFixed(digits));

function viewDiff(view, today, before) {
  const decksNow = (today.meta[view.key] || []).slice(0, view.top || Infinity);
  const prev = new Map((before?.meta[view.key] || []).map(d => [d.id, d]));
  const now = new Map(decksNow.map(d => [d.id, d]));
  const lines = [`## ${view.label}`, ''];
  if (!decksNow.length) return [...lines, '（這次沒有抓到資料）', ''];

  lines.push('| 排名 | 牌組 | 使用率 | 使用率變化 | 排名變化 |', '|---:|---|---:|---:|---:|');
  for (const d of decksNow) {
    const p = prev.get(d.id);
    const shareChange = !before ? '' : p ? `${signed(d.share - p.share)} 點` : '新進榜';
    const rankChange = !before || !p ? '' : p.rank === d.rank ? '—' : p.rank > d.rank ? `↑${p.rank - d.rank}` : `↓${d.rank - p.rank}`;
    lines.push(`| ${d.rank} | ${deckLabel(d)} | ${d.share.toFixed(2)}% | ${shareChange} | ${rankChange} |`);
  }
  if (before) {
    const dropped = [...prev.values()].filter(d => !now.has(d.id) && (!view.top || d.rank <= view.top));
    lines.push('', `跌出名單：${dropped.length ? dropped.map(d => `${deckLabel(d)}（原第 ${d.rank} 名，${d.share.toFixed(2)}%）`).join('、') : '無'}`);
  }
  return [...lines, ''];
}

const cardKey = c => `${c.section}|${c.name}`;
const cardLabel = c => {
  const local = c.nameZh || c.nameJa;
  return local && local !== c.name ? `${local}（${c.name}）` : c.name;
};

function listDiff(id, list, prevList) {
  const lines = [`### ${deckLabel(list)}`, '', `範例牌表：${list.player} · ${list.placing}${list.tournament ? `（${list.tournament}）` : ''} · ${list.listUrl}`];
  if (!prevList) return [...lines, '', '（前一天沒有這副牌的牌表，無法比較）', ''];

  const sameSource = prevList.listUrl === list.listUrl;
  if (sameSource) return [...lines, '', '和前一天是同一份牌表，沒有變化。', ''];

  const counts = cards => cards.reduce((m, c) => m.set(cardKey(c), { ...c, count: (m.get(cardKey(c))?.count || 0) + c.count }), new Map());
  const now = counts(list.cards);
  const prev = counts(prevList.cards);
  const changes = [...new Set([...now.keys(), ...prev.keys()])]
    .map(k => ({ card: now.get(k) || prev.get(k), delta: (now.get(k)?.count || 0) - (prev.get(k)?.count || 0) }))
    .filter(c => c.delta !== 0)
    .sort((a, b) => a.card.section.localeCompare(b.card.section) || b.delta - a.delta);

  lines.push('', `換成另一份牌表（前一份：${prevList.player} · ${prevList.placing}${prevList.tournament ? `（${prevList.tournament}）` : ''}）。不同玩家的構築本來就會不同，這是兩份牌表的差異，不一定代表整體環境的變化：`, '');
  if (!changes.length) lines.push('- 兩份牌表內容完全相同');
  for (const { card, delta } of changes) {
    lines.push(`- ${SECTION_LABELS[card.section]}　${delta > 0 ? '+' : ''}${delta} ${cardLabel(card)}`);
  }
  return [...lines, ''];
}

// ─── City League ─────────────────────────────────────────────
const CITY_WINDOW_DAYS = 7;
const CITY_TABLE_ROWS = 15;
// Detailed results listed for the newest this many tournaments; the rest only count in the stats
const CITY_DETAIL_MAX = 30;

const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const pct = (n, total) => (total ? (n / total) * 100 : 0);

async function cityStatsMarkdown(db) {
  // Counted back from the newest result, not today: Limitless posts results a day or two late
  const latest = Object.values(db.tournaments).map(t => t.date).sort().pop();
  if (!latest) return ['## 日本城市聯賽（City League）：牌組統計', '', '（還沒有收集到城市聯賽的結果）', ''];
  const recentFrom = addDays(latest, -(CITY_WINDOW_DAYS - 1));
  const prevTo = addDays(recentFrom, -1);
  const prevFrom = addDays(prevTo, -(CITY_WINDOW_DAYS - 1));
  const recent = cityLeague.stats(db, recentFrom, latest);
  const prev = cityLeague.stats(db, prevFrom, prevTo);

  const lines = [
    '## 日本城市聯賽（City League）：牌組統計',
    '',
    `近 ${CITY_WINDOW_DAYS} 天（${recentFrom}～${latest}）：${recent.tournaments} 場、${recent.slots} 個入賞名額。前 ${CITY_WINDOW_DAYS} 天（${prevFrom}～${prevTo}）：${prev.tournaments} 場、${prev.slots} 個名額。`,
    ...(prev.tournaments < 20 ? [`注意：前 ${CITY_WINDOW_DAYS} 天只有 ${prev.tournaments} 場，樣本太少，占比變化僅供參考。`] : []),
    '「入賞」是 Limitless 記錄的名次（通常是前 16 名）；占比 = 該牌組入賞次數 ÷ 所有入賞名額。牌組依 Limitless 標示的寶可夢區分，同一主軸的不同變化型會分開計算。',
    '',
    '| 牌組 | 近 7 天入賞 | 占比 | 冠軍 | 前 7 天入賞 | 占比 | 占比變化 |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  const rows = [...recent.decks.values()].sort((a, b) => b.top - a.top || b.wins - a.wins).slice(0, CITY_TABLE_ROWS);
  for (const d of rows) {
    const p = prev.decks.get(cityLeague.deckKey(d.deck));
    const now = pct(d.top, recent.slots);
    const before = pct(p?.top || 0, prev.slots);
    const change = prev.slots ? `${signed(now - before, 1)} 點` : '—';
    lines.push(`| ${await cityLeague.deckLabel(d.deck)} | ${d.top} | ${now.toFixed(1)}% | ${d.wins} | ${p?.top || 0} | ${prev.slots ? `${before.toFixed(1)}%` : '—'} | ${change} |`);
  }
  // Archetypes that placed last week but not at all this week
  const gone = [...prev.decks.values()].filter(d => !recent.decks.has(cityLeague.deckKey(d.deck)) && d.top >= 2);
  if (gone.length) {
    const labels = await Promise.all(gone.map(async d => `${await cityLeague.deckLabel(d.deck)}（前 7 天 ${d.top} 次）`));
    lines.push('', `前 7 天有入賞、近 7 天完全沒有：${labels.join('、')}`);
  }
  return [...lines, ''];
}

async function cardLine(cards) {
  const parts = [];
  for (const c of cards) {
    const zh = c.section === 'pokemon' ? await names.translateCardName(c.name, 'zh') : null;
    parts.push(`${c.count} ${zh && zh !== c.name ? `${zh}（${c.name}）` : c.name}`);
  }
  return parts.join('、');
}

async function cityNewMarkdown(db, before) {
  const seen = new Set(before?.cityLeagueIds || []);
  const fresh = Object.values(db.tournaments)
    .filter(t => !seen.has(t.id))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
  const lines = [`## 日本城市聯賽：新收集到的結果（${fresh.length} 場）`, ''];
  if (!fresh.length) return [...lines, '這次沒有新的城市聯賽結果。', ''];
  if (fresh.length > CITY_DETAIL_MAX) {
    lines.push(`只列出最新的 ${CITY_DETAIL_MAX} 場，其餘 ${fresh.length - CITY_DETAIL_MAX} 場已算進上面的統計。`, '');
  }
  for (const t of fresh.slice(0, CITY_DETAIL_MAX)) {
    lines.push(`### ${t.date} ${t.city} · ${t.shop}`, '', t.url, '');
    const top = await Promise.all(t.placings.slice(0, 8).map(async p => `${p.place}. ${await cityLeague.deckLabel(p.deck)}`));
    lines.push(`前 8 名：${top.join('；')}`);
    if (t.winnerList?.length) {
      for (const [key, label] of Object.entries(SECTION_LABELS)) {
        const cards = t.winnerList.filter(c => c.section === key);
        if (cards.length) lines.push('', `冠軍牌表・${label}：${await cardLine(cards)}`);
      }
    }
    lines.push('');
  }
  return lines;
}

async function diffMarkdown(today, before) {
  const lines = [
    `# 環境變化 ${today.date}${before ? `（與 ${before.date} 比較）` : ''}`,
    '',
    `資料來源：${today.source}，抓取時間 ${new Date(today.takenAt).toLocaleString('zh-TW', { hour12: false })}。使用率是 Limitless 依比賽積分計算的比例，「點」是百分點。`,
    '',
  ];
  if (!before) lines.push('這是第一份快照，還沒有前一天的資料可以比較，下面列出目前的狀況。', '');
  const db = await cityLeague.load();
  lines.push(...await cityStatsMarkdown(db));
  lines.push(...await cityNewMarkdown(db, before));
  for (const view of VIEWS) lines.push(...viewDiff(view, today, before));

  lines.push(`## 範例牌表（日本／亞洲賽制前 ${TOP_LISTS} 名）`, '');
  // In ranking order (an object's numeric keys would otherwise come out sorted by id)
  const ids = (today.meta['standard-jp/3months'] || []).map(d => d.id).filter(id => today.lists[id]);
  if (!ids.length) lines.push('（這次沒有抓到牌表）', '');
  for (const id of ids) lines.push(...listDiff(id, today.lists[id], before?.lists[id]));
  return lines.join('\n');
}

// ─── Saving ──────────────────────────────────────────────────
async function writeFile(file, text) {
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, text, 'utf-8');
  await fs.promises.rename(tmp, file);
}

async function prune(dates) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toLocaleDateString('sv-SE');
  for (const date of dates.filter(d => d < cutoff)) {
    await fs.promises.rm(fileFor(date, '.json'), { force: true });
    await fs.promises.rm(fileFor(date, '.diff.md'), { force: true });
  }
}

let running = null;

// Today's snapshot, unless it's already been taken; one at a time
function snapshotIfDue() {
  running ||= (async () => {
    const date = today();
    const dates = await listDates();
    if (dates.includes(date)) return null;

    console.log('[MetaHistory] Taking today\'s meta snapshot...');
    const snapshot = await buildSnapshot(date);
    const previousDate = dates.filter(d => d < date).pop();
    const before = previousDate ? JSON.parse(await fs.promises.readFile(fileFor(previousDate, '.json'), 'utf-8')) : null;

    await fs.promises.mkdir(DIR, { recursive: true });
    await writeFile(fileFor(date, '.json'), JSON.stringify(snapshot, null, 2));
    await writeFile(fileFor(date, '.diff.md'), await diffMarkdown(snapshot, before));
    await prune(dates);
    console.log(`[MetaHistory] Saved ${date}${previousDate ? ` (compared with ${previousDate})` : ''}`);
    return date;
  })().finally(() => { running = null; });
  return running;
}

// Run after every hourly fetch: new City League results, then the day's snapshot if it's due.
// A City League failure doesn't hold up the snapshot.
async function update() {
  await cityLeague.collect().catch(e => console.error('[CityLeague]', e.message));
  return snapshotIfDue();
}

module.exports = { DIR, update, snapshotIfDue, diffMarkdown };
