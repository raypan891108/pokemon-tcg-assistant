const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const REGION = 'jp';
const BASE_URL = 'https://www.pokemon-card.com';

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

function generateId(text) {
  return `jp-${crypto.createHash('sha1').update(text).digest('hex').substring(0, 16)}`;
}

async function scrapeProducts() {
  const products = [];
  try {
    const $ = await fetchPage(`${BASE_URL}/products/`);

    $('li.pack-item, .product-list-item, [class*="pack"], [class*="product"]').each((_, el) => {
      const name = $(el).find('h2, h3, .name, p, a').first().text().trim();
      const imageUrl = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
      const url = $(el).find('a').attr('href');
      const dateText = $(el).find('[class*="date"], time, .release').text().trim();

      if (name && name.length > 2) {
        products.push({
          id: generateId(name + 'jp-product'),
          name,
          region: REGION,
          type: detectJPType(name),
          imageUrl: imageUrl ? (imageUrl.startsWith('http') ? imageUrl : BASE_URL + imageUrl) : null,
          url: url ? (url.startsWith('http') ? url : BASE_URL + url) : null,
          releaseDate: parseJPDate(dateText),
          description: '',
          source: 'jp-official',
        });
      }
    });
  } catch (e) {
    console.error('[JP Scraper] Products error:', e.message);
  }

  // Add seed data for Japan
  return [...products, ...getSeedProducts()];
}

async function scrapeEvents() {
  const events = [];
  try {
    const $ = await fetchPage(`${BASE_URL}/info/`);

    // News list: <a.List_item_inner> holds a category label, the title and a .Date.
    // The same item appears under several tabs, so dedupe by URL.
    const seen = new Set();
    $('li.List_item > a.List_item_inner').each((_, el) => {
      const label = $(el).find('.Calendar_Label').text().trim();
      const url = $(el).attr('href');
      if (label !== 'イベント' || !url || seen.has(url)) return;
      seen.add(url);

      const body = $(el).find('.List_body').clone();
      const dateText = body.find('.Date').text().trim();
      body.find('.Calendar_Label, .Date').remove();
      const name = body.text().replace(/\s+/g, ' ').trim();

      if (name) {
        events.push({
          id: generateId(url + 'jp-event'),
          name,
          region: REGION,
          // Prefer an event date written in the title over the publish date
          date: parseJPDate(name) || parseJPDate(dateText),
          location: '日本',
          url: url ? (url.startsWith('http') ? url : BASE_URL + url) : null,
          description: '',
          source: 'jp-official',
        });
      }
    });
  } catch (e) {
    console.error('[JP Scraper] Events error:', e.message);
  }
  return events;
}

async function scrapeTournaments() {
  const tournaments = [];
  try {
    const $ = await fetchPage(`${BASE_URL}/event/tournament/`);

    $('li, article, [class*="tournament"], [class*="battle"]').each((_, el) => {
      const name = $(el).find('a, h3, h2, .title').first().text().trim();
      const dateText = $(el).find('time, .date, [class*="date"]').text().trim();
      const deadlineText = $(el).find('[class*="entry"], [class*="deadline"]').text().trim();
      const url = $(el).find('a').attr('href');

      if (name && name.length > 3) {
        tournaments.push({
          id: generateId(name + dateText + 'jp-tournament'),
          name,
          region: REGION,
          date: parseJPDate(dateText) || parseJPDate(name),
          deadline: parseJPDate(deadlineText),
          location: '日本',
          registrationUrl: url ? (url.startsWith('http') ? url : BASE_URL + url) : null,
          url: url ? (url.startsWith('http') ? url : BASE_URL + url) : null,
          description: '',
          source: 'jp-official',
        });
      }
    });
  } catch (e) {
    console.error('[JP Scraper] Tournaments error:', e.message);
  }
  return tournaments;
}

function detectJPType(name) {
  if (name.includes('デッキ') || name.includes('スターター')) return '構築組';
  if (name.includes('スペシャル') || name.includes('ギフト')) return '特別組合';
  if (name.includes('コレクション')) return '收藏組';
  return '補充包';
}

function parseJPDate(text) {
  if (!text) return null;
  const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }
  const m2 = text.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m2) {
    return `${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`;
  }
  return null;
}

function getSeedProducts() {
  return [
    {
      id: 'jp-seed-sv9',
      name: 'テラスタルフェスex',
      region: 'jp',
      type: '補充包',
      imageUrl: null,
      url: 'https://www.pokemon-card.com/products/',
      releaseDate: '2024-10-18',
      description: 'SV9 最新擴充包',
      source: 'seed',
    },
    {
      id: 'jp-seed-sv8a',
      name: 'ライジングフィスト',
      region: 'jp',
      type: '補充包',
      imageUrl: null,
      url: 'https://www.pokemon-card.com/products/',
      releaseDate: '2024-08-02',
      description: 'SV8a 擴充包',
      source: 'seed',
    },
  ];
}

module.exports = { scrapeProducts, scrapeEvents, scrapeTournaments };
