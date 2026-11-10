const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const names = require('./card-names');
const limitless = require('../scrapers/limitless-scraper');

// Japanese City League results from Limitless, collected on every hourly fetch so busy weekends
// aren't missed (its list only shows the latest 25). Each tournament is fetched once: the top
// placings with their archetypes, and the winner's decklist. Kept for 180 days in
// meta-history/city-league.json; the daily snapshot (meta-history.js) summarises it.

const FILE = path.join(storage.dataDir, 'meta-history', 'city-league.json');
const KEEP_DAYS = 180;
const PAUSE_MS = 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function load() {
  try {
    return JSON.parse(await fs.promises.readFile(FILE, 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { tournaments: {} };
    throw e;
  }
}

async function save(db) {
  await fs.promises.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2), 'utf-8');
  await fs.promises.rename(tmp, FILE);
}

function sectionOf(heading) {
  if (/^Pok/i.test(heading)) return 'pokemon';
  if (/^Energy/i.test(heading)) return 'energy';
  return 'trainer';
}

let running = null;

// New results since the last run; returns how many tournaments were added
function collect() {
  running ||= (async () => {
    const db = await load();
    const known = id => db.tournaments[id];
    // First run: look about four weeks back, so there's a previous week to compare with.
    // More new results than one page shows: look two weeks back.
    let list;
    if (!Object.keys(db.tournaments).length) {
      list = await limitless.scrapeCityLeagues(100);
      await sleep(PAUSE_MS);
      list.push(...await limitless.scrapeCityLeagues(100, 2));
    } else {
      list = await limitless.scrapeCityLeagues();
      if (list.length && list.every(t => !known(t.id))) {
        await sleep(PAUSE_MS);
        list = await limitless.scrapeCityLeagues(100);
      }
    }

    let added = 0;
    // Oldest first, saving after each, so an interrupted run keeps what it got
    for (const t of list.filter(t => !known(t.id)).reverse()) {
      await sleep(PAUSE_MS);
      const placings = await limitless.scrapeCityLeague(t.id);
      // Results not posted yet: try again on a later fetch
      if (!placings.length) continue;
      let winnerList = null;
      if (placings[0].listUrl) {
        await sleep(PAUSE_MS);
        try {
          const sections = await limitless.scrapeList(placings[0].listUrl);
          winnerList = sections.flatMap(s => s.cards.map(c => ({ section: sectionOf(s.heading), name: c.name, count: c.count })));
        } catch (e) {
          console.error(`[CityLeague] Winner list ${t.id}:`, e.message);
        }
      }
      db.tournaments[t.id] = { ...t, url: `https://limitlesstcg.com/tournaments/jp/${t.id}`, placings, winnerList, collectedAt: new Date().toISOString() };
      added++;
      await save(db);
    }

    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toLocaleDateString('sv-SE');
    const old = Object.values(db.tournaments).filter(t => t.date < cutoff);
    if (old.length) {
      old.forEach(t => delete db.tournaments[t.id]);
      await save(db);
    }
    if (added) console.log(`[CityLeague] Added ${added} tournament(s)`);
    return added;
  })().finally(() => { running = null; });
  return running;
}

// ─── Summaries for the daily snapshot ───────────────────────
const deckKey = deck => deck.join('/') || '(unknown)';

const zhCache = new Map();
// Limitless icon names put Mega last ("kangaskhan-mega"); card names put it first
async function slugName(slug) {
  if (!zhCache.has(slug)) {
    const mega = slug.match(/^(.+)-mega(?:-([xy]))?$/);
    const name = mega ? `Mega ${mega[1].replace(/-/g, ' ')}` : slug.replace(/-/g, ' ');
    const zh = await names.translateCardName(name, 'zh');
    zhCache.set(slug, zh && mega?.[2] ? `${zh}${mega[2].toUpperCase()}` : zh);
  }
  return zhCache.get(slug);
}

// "多龍巴魯托／土龍節節（dragapult/dudunsparce）"
async function deckLabel(deck) {
  if (!deck.length) return '（未知牌組）';
  const zh = await Promise.all(deck.map(async s => (await slugName(s)) || s));
  return `${zh.join('／')}（${deck.join('/')}）`;
}

// Top-16 appearances and wins per archetype over [from, to] (dates as YYYY-MM-DD, inclusive)
function stats(db, from, to) {
  const tournaments = Object.values(db.tournaments).filter(t => t.date >= from && t.date <= to);
  const decks = new Map();
  let slots = 0;
  for (const t of tournaments) {
    for (const p of t.placings) {
      slots++;
      const key = deckKey(p.deck);
      const d = decks.get(key) || { deck: p.deck, top: 0, wins: 0 };
      d.top++;
      if (p.place === 1) d.wins++;
      decks.set(key, d);
    }
  }
  return { tournaments: tournaments.length, slots, decks };
}

module.exports = { FILE, collect, load, stats, deckKey, deckLabel, slugName };
