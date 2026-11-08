const crypto = require('crypto');
const storage = require('./storage');
const ptcgtw = require('../scrapers/ptcgtw-scraper');

// Your own decks (我的牌組 page): the cards in each deck with the price you paid or found,
// and the matches you played with it. Prices are typed in by hand, optionally with the
// 卡拍拍 listing they came from; nothing is fetched. The page sums up the cost.
//
// Deck: { id, name, notes, cards: [Card], matches: [Match], createdAt, updatedAt }
// Card: { id, name, section, print, quantity, owned, price, url, inventoryId }
//   price is NT$ per card (null until known); owned is how many of `quantity` you already have
// Match: { id, date, event, opponent, result, notes }

const SECTIONS = ['pokemon', 'trainer', 'energy'];
const RESULTS = ['win', 'loss', 'tie'];
const MAX_DECKS = 100;
const MAX_CARDS = 120;
const MAX_MATCHES = 1000;

const newId = () => crypto.randomBytes(6).toString('hex');
const text = (value, max) => String(value ?? '').trim().slice(0, max);

function count(value, label, { min, max }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}需為 ${min}–${max} 的整數`);
  return n;
}

function price(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('價格需為 0 以上的數字');
  return Math.round(n * 100) / 100;
}

// Only web pages: a javascript: or data: link would run code when clicked
function url(value) {
  const raw = text(value, 2000);
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`網址格式不正確：${raw}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`只能放 http 或 https 網址：${raw}`);
  return parsed.href;
}

function date(value) {
  const raw = text(value, 10);
  // Round-tripped, so an impossible date like 2026-02-30 is refused rather than rolled over
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error('日期格式不正確');
  }
  return raw;
}

// Rebuilt field by field, so only known fields are stored and ids stay unique
function validate(body) {
  const name = text(body?.name, 60);
  if (!name) throw new Error('牌組名稱不能空白');
  const cards = Array.isArray(body.cards) ? body.cards : [];
  const matches = Array.isArray(body.matches) ? body.matches : [];
  if (cards.length > MAX_CARDS) throw new Error(`一副牌最多 ${MAX_CARDS} 種卡`);
  if (matches.length > MAX_MATCHES) throw new Error(`最多 ${MAX_MATCHES} 筆比賽紀錄`);

  const seen = new Set();
  const uniqueId = id => {
    const clean = typeof id === 'string' && /^[\w-]{1,40}$/.test(id) && !seen.has(id) ? id : newId();
    seen.add(clean);
    return clean;
  };

  return {
    name,
    notes: text(body.notes, 500),
    cards: cards.map(c => {
      const cardName = text(c.name, 80);
      if (!cardName) throw new Error('卡名不能空白');
      const quantity = count(c.quantity ?? 1, `「${cardName}」的張數`, { min: 1, max: 60 });
      return {
        id: uniqueId(c.id),
        name: cardName,
        section: SECTIONS.includes(c.section) ? c.section : 'trainer',
        print: text(c.print, 40),
        quantity,
        owned: count(c.owned ?? 0, `「${cardName}」已擁有的張數`, { min: 0, max: quantity }),
        price: price(c.price),
        url: url(c.url),
        inventoryId: text(c.inventoryId, 60) || null,
      };
    }),
    matches: matches.map(m => {
      if (!RESULTS.includes(m.result)) throw new Error('比賽結果需為勝、敗或和');
      return {
        id: uniqueId(m.id),
        date: date(m.date),
        event: text(m.event, 80),
        opponent: text(m.opponent, 80),
        result: m.result,
        notes: text(m.notes, 300),
      };
    }),
  };
}

async function list() {
  return storage.getMyDecks();
}

async function create(body) {
  const decks = await storage.getMyDecks();
  if (decks.length >= MAX_DECKS) throw new Error(`最多 ${MAX_DECKS} 副牌組`);
  const now = new Date().toISOString();
  const deck = { id: newId(), ...validate(body), createdAt: now, updatedAt: now };
  await storage.saveMyDecks([deck, ...decks]);
  return deck;
}

// Saves the whole deck (cards and matches included); null when it doesn't exist
async function update(id, body) {
  const decks = await storage.getMyDecks();
  const index = decks.findIndex(d => d.id === id);
  if (index < 0) return null;
  const deck = { ...decks[index], ...validate(body), updatedAt: new Date().toISOString() };
  decks[index] = deck;
  await storage.saveMyDecks(decks);
  return deck;
}

async function remove(id) {
  const decks = await storage.getMyDecks();
  const next = decks.filter(d => d.id !== id);
  if (next.length === decks.length) return false;
  await storage.saveMyDecks(next);
  return true;
}

// A new deck from a deck shared on PTCGTW; prices start at Kiwi PTCG's, linked as the source
async function importPtcgtw(body) {
  const deck = await ptcgtw.loadDeck(body?.code);
  return create({
    name: text(body?.name, 60) || deck.name || `PTCGTW ${deck.code}`,
    notes: `從 PTCGTW 匯入（代碼 ${deck.code}）· 價格是 Kiwi PTCG 的售價`,
    cards: deck.cards,
    matches: [],
  });
}

module.exports = { list, create, update, remove, importPtcgtw };
