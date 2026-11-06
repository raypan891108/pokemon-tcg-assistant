const fetch = require('./fetch');
const cheerio = require('cheerio');
const crypto = require('crypto');

const REGION = 'us';
const BASE_URL = 'https://www.pokemon.com';

async function fetchPage(url) {
  const data = await fetch.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
  });
  return cheerio.load(data);
}

function generateId(text) {
  return `us-${crypto.createHash('sha1').update(text).digest('hex').substring(0, 16)}`;
}

// Failures are thrown so the scheduler can show which source is broken
async function scrapeProducts() {
  const products = [];
  const $ = await fetchPage(`${BASE_URL}/us/pokemon-tcg/pokemon-cards/`);

  $('[class*="product"], [class*="card-set"], article').each((_, el) => {
    const name = $(el).find('h2, h3, .title, a').first().text().trim();
    const imageUrl = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
    const url = $(el).find('a').attr('href');
    const dateText = $(el).find('[class*="date"], time').text().trim();

    if (name && name.length > 3) {
      products.push({
        id: generateId(name + 'us-product'),
        name,
        region: REGION,
        type: detectUSType(name),
        imageUrl: imageUrl ? (imageUrl.startsWith('http') ? imageUrl : BASE_URL + imageUrl) : null,
        url: url ? (url.startsWith('http') ? url : BASE_URL + url) : null,
        releaseDate: parseDate(dateText),
        description: '',
        source: 'us-official',
      });
    }
  });

  return products;
}

async function scrapeEvents() {
  const events = [];
  const $ = await fetchPage('https://www.pokemon.com/us/play-pokemon/pokemon-events/find-an-event/');

  $('[class*="event"], article, li').each((_, el) => {
    const name = $(el).find('h2, h3, a, .title').first().text().trim();
    const dateText = $(el).find('time, [class*="date"]').text().trim();
    const location = $(el).find('[class*="location"], address').text().trim();
    const url = $(el).find('a').attr('href');

    if (name && name.length > 3) {
      events.push({
        id: generateId(name + dateText + 'us-event'),
        name,
        region: REGION,
        date: parseDate(dateText),
        location: location || 'United States',
        url: url ? (url.startsWith('http') ? url : BASE_URL + url) : null,
        description: '',
        source: 'us-official',
      });
    }
  });
  return events;
}

async function scrapeTournaments() {
  const tournaments = [];
  const $ = await fetchPage('https://www.pokemon.com/us/play-pokemon/tournaments/');

  $('[class*="tournament"], [class*="championship"], article').each((_, el) => {
    const name = $(el).find('h2, h3, a, .title').first().text().trim();
    const dateText = $(el).find('time, [class*="date"]').text().trim();
    const deadlineText = $(el).find('[class*="deadline"], [class*="register"]').text().trim();
    const location = $(el).find('[class*="location"], address').text().trim();
    const url = $(el).find('a').attr('href');

    if (name && name.length > 3) {
      tournaments.push({
        id: generateId(name + dateText + 'us-tournament'),
        name,
        region: REGION,
        date: parseDate(dateText),
        deadline: parseDate(deadlineText),
        location: location || 'United States',
        registrationUrl: url ? (url.startsWith('http') ? url : BASE_URL + url) : null,
        url: url ? (url.startsWith('http') ? url : BASE_URL + url) : null,
        description: '',
        source: 'us-official',
      });
    }
  });
  return tournaments;
}

function detectUSType(name) {
  const lower = name.toLowerCase();
  if (lower.includes('deck') || lower.includes('starter')) return '構築組';
  if (lower.includes('collection') || lower.includes('box')) return '收藏組';
  if (lower.includes('bundle') || lower.includes('gift')) return '特別組合';
  return '補充包';
}

function parseDate(text) {
  if (!text) return null;
  const patterns = [
    /(\w+ \d{1,2},? \d{4})/,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      try {
        const d = new Date(m[1]);
        if (!isNaN(d)) return d.toISOString().split('T')[0];
      } catch (_) {}
    }
  }
  return null;
}

module.exports = { scrapeProducts, scrapeEvents, scrapeTournaments };
