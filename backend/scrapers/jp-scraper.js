const fetch = require('./fetch');
const cheerio = require('cheerio');
const crypto = require('crypto');

const REGION = 'jp';
const BASE_URL = 'https://www.pokemon-card.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ja-JP,ja;q=0.9',
};

// Product catalogue types to follow (newest page of each); peripherals such as sleeves are skipped
const PRODUCT_TYPES = { expansion: '擴充包', construction: '構築組', others: '特別組合' };

async function fetchPage(url) {
  return cheerio.load(await fetch.get(url, { headers: HEADERS, timeout: 15000 }));
}

function generateId(text) {
  return `jp-${crypto.createHash('sha1').update(text).digest('hex').substring(0, 16)}`;
}

function absoluteUrl(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : BASE_URL + url;
}

// News list on /info/: each <a.List_item_inner> has a category label, the title and a .Date.
// The same item appears under several tabs, so dedupe by URL.
async function scrapeNewsList(category) {
  const $ = await fetchPage(`${BASE_URL}/info/`);
  const items = [];
  const seen = new Set();
  $('li.List_item > a.List_item_inner').each((_, el) => {
    const label = $(el).find('.Calendar_Label').text().trim();
    const url = $(el).attr('href');
    if (label !== category || !url || seen.has(url)) return;
    seen.add(url);

    const body = $(el).find('.List_body').clone();
    const dateText = body.find('.Date').text().trim();
    body.find('.Calendar_Label, .Date').remove();
    const name = body.text().replace(/\s+/g, ' ').trim();
    // href is kept as written on the page: event ids are derived from it
    if (name) items.push({ name, dateText, url: absoluteUrl(url), href: url });
  });
  return items;
}

// The same product keeps one id whether it comes from the news or, later, the catalogue:
// "拡張パック「ハドウシーカー」" and "…「ハドウシーカー」が、11月27日（金）に発売！" share "ハドウシーカー"
function productKey(title) {
  const m = title.match(/「([^」]+)」/);
  return (m ? m[1] : title).replace(/\s+/g, '');
}

// Several sources: thrown only when all of them fail, otherwise logged.
// Single-source scrapers below just throw, so the scheduler can show which source is broken.
async function scrapeProducts() {
  const products = new Map();
  const errors = [];

  // Products announced in the news, often before they reach the catalogue
  let announced = [];
  try {
    announced = (await scrapeNewsList('商品'))
      .map(item => ({ ...item, named: item.name.match(/^(.*?「[^」]+」)/), releaseDate: parseReleaseDate(item.name, item.dateText) }))
      .filter(item => item.named && item.releaseDate)
      .map(item => ({ ...item, key: productKey(item.name) }));
  } catch (e) {
    console.error('[JP Scraper] Product news error:', e.message);
    errors.push(`新聞：${e.message}`);
  }

  for (const [type, label] of Object.entries(PRODUCT_TYPES)) {
    try {
      const data = await fetch.get(`${BASE_URL}/products/resultAPI.php?productType=${type}&page=1`, { headers: HEADERS, timeout: 15000 });
      for (const p of data.products || []) {
        // Reuse the news item's key when the catalogue title contains it, so both share one id
        const title = p.productTitle.replace(/\s+/g, '');
        const key = announced.find(a => title.includes(a.key))?.key || productKey(p.productTitle);
        products.set(key, {
          id: generateId(`product:${key}`),
          name: p.productTitle.trim(),
          region: REGION,
          type: label,
          imageUrl: absoluteUrl(p.tumbsImg),
          url: absoluteUrl(p.link_detailPage),
          releaseDate: parseJPDate(p.releaseDate),
          description: p.priceTxt || '',
          source: 'jp-official',
        });
      }
    } catch (e) {
      console.error(`[JP Scraper] Products (${type}) error:`, e.message);
      errors.push(`${label}：${e.message}`);
    }
  }

  for (const item of announced) {
    if (products.has(item.key)) continue;
    products.set(item.key, {
      id: generateId(`product:${item.key}`),
      name: item.named[1],
      region: REGION,
      type: detectJPType(item.named[1]),
      imageUrl: null,
      url: item.url,
      releaseDate: item.releaseDate,
      description: '',
      source: 'jp-news',
    });
  }

  if (errors.length === Object.keys(PRODUCT_TYPES).length + 1) throw new Error(errors.join('；'));
  return [...products.values()];
}

async function scrapeEvents() {
  const events = [];
  for (const { name, dateText, url, href } of await scrapeNewsList('イベント')) {
    events.push({
      id: generateId(href + 'jp-event'),
      name,
      region: REGION,
      // Prefer an event date written in the title over the publish date
      date: parseJPDate(name) || parseJPDate(dateText),
      location: '日本',
      url,
      description: '',
      source: 'jp-official',
    });
  }
  return events;
}

async function scrapeTournaments() {
  const tournaments = [];
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
        registrationUrl: absoluteUrl(url),
        url: absoluteUrl(url),
        description: '',
        source: 'jp-official',
      });
    }
  });
  return tournaments;
}

function detectJPType(name) {
  if (name.includes('デッキ') || name.includes('スターター')) return '構築組';
  if (name.includes('スペシャル') || name.includes('ギフト')) return '特別組合';
  if (name.includes('コレクション')) return '收藏組';
  return '擴充包';
}

function parseJPDate(text) {
  if (!text) return null;
  // "2026年 9月16日（水）" — the catalogue pads with spaces
  const m = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }
  const m2 = text.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m2) {
    return `${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`;
  }
  return null;
}

// "…が、11月27日（金）に発売！" published 2026.10.23 → 2026-11-27. The year is the
// publish year, or the next one when the month is well before the publish month.
function parseReleaseDate(title, publishedText) {
  const full = title.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日[^！!]*?発売/);
  if (full) return parseJPDate(full[0]);
  const m = title.match(/(\d{1,2})月(\d{1,2})日[^！!]*?に発売/);
  const published = parseJPDate(publishedText);
  if (!m || !published) return null;
  const [pubYear, pubMonth] = published.split('-').map(Number);
  const month = Number(m[1]);
  const year = month < pubMonth - 2 ? pubYear + 1 : pubYear;
  return `${year}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

module.exports = { scrapeProducts, scrapeEvents, scrapeTournaments };
