const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const REGION = 'us';
const BASE_URL = 'https://www.pokemon.com';

async function fetchPage(url) {
  const { data } = await axios.get(url, {
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

async function scrapeProducts() {
  const products = [];
  try {
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
  } catch (e) {
    console.error('[US Scraper] Products error:', e.message);
  }

  return [...products, ...getSeedProducts()];
}

async function scrapeEvents() {
  const events = [];
  try {
    // Try Play! Pokemon events API
    const { data } = await axios.get('https://www.pokemon.com/us/play-pokemon/pokemon-events/find-an-event/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });
    const $ = cheerio.load(data);

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
  } catch (e) {
    console.error('[US Scraper] Events error:', e.message);
  }
  return events;
}

async function scrapeTournaments() {
  const tournaments = [];
  try {
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
  } catch (e) {
    console.error('[US Scraper] Tournaments error:', e.message);
  }
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

function getSeedProducts() {
  return [
    {
      id: 'us-seed-sv8',
      name: 'Surging Sparks',
      region: 'us',
      type: '補充包',
      imageUrl: null,
      url: 'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/',
      releaseDate: '2024-11-08',
      description: 'Scarlet & Violet—Surging Sparks expansion',
      source: 'seed',
    },
    {
      id: 'us-seed-sv9',
      name: 'Prismatic Evolutions',
      region: 'us',
      type: '特別組合',
      imageUrl: null,
      url: 'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/',
      releaseDate: '2025-01-17',
      description: 'Scarlet & Violet special set',
      source: 'seed',
    },
  ];
}

module.exports = { scrapeProducts, scrapeEvents, scrapeTournaments };
