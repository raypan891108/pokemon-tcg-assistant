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

// Card URLs look like /sell/poc/card/sv08a/10481
function idFromUrl(url) {
  const m = (url || '').match(/\/card\/([^/]+)\/(\d+)/);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Keyword can be a Japanese card name or a card number such as "236/187"
async function searchCards(keyword) {
  const $ = await fetchPage(`${BASE_URL}/sell/poc/s/search?search_word=${encodeURIComponent(keyword)}`);
  const results = [];
  const seen = new Set();
  $('.card-product').each((_, el) => {
    const url = $(el).find('a[href*="/card/"]').first().attr('href');
    const id = idFromUrl(url);
    if (!id || seen.has(id)) return;
    seen.add(id);

    const img = $(el).find('img.card');
    // Image alt is "<number> <rarity> <name>", e.g. "236/187 UR ピカチュウex"
    const altParts = (img.attr('alt') || '').split(/\s+/);
    const cardNumber = $(el).find('span.border').first().text().trim() || altParts[0] || '';
    results.push({
      id,
      name: $(el).find('h4').first().text().trim(),
      cardNumber,
      rarity: altParts.length >= 3 ? altParts[1] : '',
      set: id.split('-')[0].toUpperCase(),
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
