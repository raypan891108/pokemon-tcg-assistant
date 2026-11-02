const axios = require('axios');
const cheerio = require('cheerio');

// Limitless TCG — tournament results and meta share for Pokemon TCG decks
const BASE_URL = 'https://limitlesstcg.com';

// locale "jp_JP" makes Limitless show decklists with Japanese card names and Japanese prints
async function fetchPage(url, locale = null) {
  const { data } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(locale ? { Cookie: `locale=${locale}` } : {}),
    },
    timeout: 15000,
  });
  return cheerio.load(data);
}

function parseDecklist($) {
  const sections = [];
  $('.decklist-column').each((_, col) => {
    const heading = $(col).find('.decklist-column-heading').text().trim();
    const cards = $(col).find('.decklist-card').map((_, card) => ({
      count: Number($(card).find('.card-count').text().trim()) || 0,
      name: $(card).find('.card-name').text().trim(),
      set: $(card).attr('data-set') || '',
      number: $(card).attr('data-number') || '',
    })).get();
    if (cards.length) sections.push({ heading, cards });
  });
  return sections;
}

// format: "standard-jp" (Japanese card pool, also used in Taiwan/Asia) or "standard" (international)
async function scrapeMetaDecks(format = 'standard-jp', time = '3months') {
  const $ = await fetchPage(`${BASE_URL}/decks?format=${encodeURIComponent(format)}&time=${encodeURIComponent(time)}`);
  const decks = [];
  $('table tr').slice(1).each((_, row) => {
    const cells = $(row).find('td');
    const link = $(row).find('a[href^="/decks/"]').first();
    const id = ((link.attr('href') || '').match(/\/decks\/(\d+)/) || [])[1];
    if (!id) return;
    decks.push({
      id,
      rank: Number(cells.eq(0).text().trim()) || decks.length + 1,
      name: link.text().replace(/\s+/g, ' ').trim(),
      icons: $(row).find('img.pokemon').map((_, img) => $(img).attr('src')).get(),
      points: Number(cells.eq(3).text().replace(/[^\d]/g, '')) || 0,
      share: parseFloat(cells.eq(4).text()) || 0,
      url: `${BASE_URL}/decks/${id}?format=${format}`,
    });
  });
  return decks;
}

// Most recent top-placing list for a deck archetype
async function scrapeSampleList(deckId, format = 'standard-jp') {
  const $ = await fetchPage(`${BASE_URL}/decks/${deckId}?format=${encodeURIComponent(format)}`);
  let tournament = '';
  let found = null;
  $('table').first().find('tr').each((_, row) => {
    if (found) return;
    const cells = $(row).find('td');
    const listHref = $(row).find('a[href^="/decks/list/"]').attr('href');
    // Sub-heading rows name the tournament ("24th October 2026 - Regional Puebla")
    const heading = $(row).find('th.sub-heading');
    if (heading.length) tournament = heading.text().replace(/\s+/g, ' ').trim();
    else if (listHref) {
      found = {
        listUrl: BASE_URL + listHref,
        // Columns: format icon, place, variant, player, list
        placing: cells.eq(1).text().trim(),
        player: $(row).find('a[href^="/players/"]').first().text().trim(),
        tournament,
      };
    }
  });
  if (!found) return null;

  const sections = parseDecklist(await fetchPage(found.listUrl));

  // The same list in Japanese, card for card in the same order: adds the Japanese name and print
  try {
    const ja = parseDecklist(await fetchPage(found.listUrl, 'jp_JP'));
    const sameShape = ja.length === sections.length && ja.every((s, i) => s.cards.length === sections[i].cards.length);
    if (sameShape) {
      sections.forEach((s, i) => s.cards.forEach((card, j) => {
        const jaCard = ja[i].cards[j];
        Object.assign(card, { nameJa: jaCard.name, jaSet: jaCard.set, jaNumber: jaCard.number });
      }));
    }
  } catch (e) {
    console.error('[Limitless] Japanese decklist error:', e.message);
  }
  return { ...found, sections };
}

module.exports = { scrapeMetaDecks, scrapeSampleList };
