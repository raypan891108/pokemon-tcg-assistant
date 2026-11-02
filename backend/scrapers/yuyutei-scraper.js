const axios = require('axios');
const cheerio = require('cheerio');

// 遊々亭 — Japanese single-card shop; its sell prices are a common market reference
const BASE_URL = 'https://yuyu-tei.jp';

async function fetchPage(url) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ja-JP,ja;q=0.9',
    },
    timeout: 15000,
  });
  return cheerio.load(data);
}

function parseYen(text) {
  const n = Number((text || '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseStock(text) {
  // "在庫 : 3 点" or "在庫 : ×"
  const m = (text || '').match(/(\d+)\s*点/);
  return m ? Number(m[1]) : 0;
}

// Yuyu-tei set code → the code printed on the card: "m06a" → "M6a", "sv08a" → "SV8a"
function formatSetCode(code) {
  const m = code.match(/^([a-z]+)0*(\d+)([a-z]*)$/i);
  return m ? `${m[1].toUpperCase()}${Number(m[2])}${m[3].toLowerCase()}` : code.toUpperCase();
}

// Card URLs look like /sell/poc/card/sv08a/10481
function idFromUrl(url) {
  const m = (url || '').match(/\/card\/([^/]+)\/(\d+)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Keyword can be a Japanese card name, a card number such as "236/187",
// or a set code plus number such as "M6a_158" (Yuyu-tei's own search can't do the last one)
async function searchCards(keyword) {
  const setNumber = parseSetNumber(keyword);
  if (setNumber) return searchBySetNumber(setNumber);
  const $ = await fetchPage(`${BASE_URL}/sell/poc/s/search?search_word=${encodeURIComponent(keyword)}`);
  return parseCardList($);
}

// "M6a_158", "M6a 158", "sv8a-236" → Yuyu-tei set codes to try and the card number.
// Yuyu-tei pads the set number to two digits ("M6a" is "m06a"), so try that form first.
function parseSetNumber(keyword) {
  const m = keyword.trim().match(/^([a-z]{1,4})(\d{1,2})([a-z]{0,2})[\s_\-#:]+(\d{1,3})$/i);
  if (!m) return null;
  const [, prefix, digits, suffix, number] = m;
  const padded = `${prefix}${digits.padStart(2, '0')}${suffix}`.toLowerCase();
  const raw = `${prefix}${digits}${suffix}`.toLowerCase();
  return { sets: [...new Set([padded, raw])], number: Number(number) };
}

// Open the set's card list and keep the cards with that number ("158/103" → 158)
async function searchBySetNumber({ sets, number }) {
  for (const set of sets) {
    let cards;
    try {
      cards = parseCardList(await fetchPage(`${BASE_URL}/sell/poc/s/${encodeURIComponent(set)}`));
    } catch (_) {
      continue;
    }
    if (cards.length) return cards.filter(c => parseInt(c.cardNumber, 10) === number);
  }
  return [];
}

// Card tiles on a search result or set page
function parseCardList($) {
  const results = [];
  const seen = new Set();
  $('.card-product').each((_, el) => {
    const url = $(el).find('a[href*="/card/"]').first().attr('href');
    const id = idFromUrl(url);
    if (!id || seen.has(id)) return;
    seen.add(id);

    const img = $(el).find('img.card');
    // Image alt is "<number> <rarity> <name>", e.g. "236/187 UR ピカチュウex"; "-" means no rarity
    const altParts = (img.attr('alt') || '').split(/\s+/);
    const cardNumber = $(el).find('span.border').first().text().trim() || altParts[0] || '';
    const rarity = altParts.length >= 3 && altParts[1] !== '-' ? altParts[1] : '';
    results.push({
      id,
      name: $(el).find('h4').first().text().trim(),
      cardNumber,
      rarity,
      set: formatSetCode(id.split('-')[0]),
      priceJpy: parseYen($(el).find('strong').first().text()),
      stock: parseStock($(el).find('.cart_sell_zaiko').first().text()),
      url,
      imageUrl: img.attr('src') || null,
    });
  });
  return results;
}

async function fetchCardPrice(url) {
  const $ = await fetchPage(url);
  return {
    priceJpy: parseYen($('.lhs h4').first().text()),
    stock: parseStock($('label.float-start').filter((_, e) => /在庫/.test($(e).text())).first().text()),
  };
}

module.exports = { searchCards, fetchCardPrice };
