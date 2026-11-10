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

// Archetype of a placing: the Pokémon icons Limitless shows for it ("dragapult", "dudunsparce")
const deckIcons = ($, el) => $(el).find('img.pokemon').map((_, img) => $(img).attr('alt')).get().filter(Boolean);

// Japanese City League results Limitless has recorded, newest first: the last 25, or with
// show = 100 a hundred at a time (about two weeks), page 2 being the hundred before that
async function scrapeCityLeagues(show = null, page = 1) {
  const query = [show && `show=${show}`, page > 1 && `page=${page}`].filter(Boolean).join('&');
  const $ = await fetchPage(`${BASE_URL}/tournaments/jp${query ? `?${query}` : ''}`);
  return $('tr[data-date]').map((_, row) => {
    const link = $(row).find('a[href*="/tournaments/jp/"]').attr('href') || '';
    const id = (link.match(/\/tournaments\/jp\/(\d+)/) || [])[1];
    if (!id) return null;
    return {
      id,
      date: $(row).attr('data-date'),
      city: $(row).attr('data-city') || '',
      shop: $(row).attr('data-shop') || '',
    };
  }).get().filter(Boolean);
}

// One City League: each placing's player, archetype and decklist link
async function scrapeCityLeague(id) {
  const $ = await fetchPage(`${BASE_URL}/tournaments/jp/${id}`);
  const placings = [];
  $('table tr').slice(1).each((_, row) => {
    const cells = $(row).find('td');
    const place = Number(cells.eq(0).text().trim());
    if (!place) return;
    const listHref = $(row).find('a[href*="/decks/list/"]').attr('href') || '';
    placings.push({
      place,
      player: cells.eq(1).text().trim(),
      deck: deckIcons($, cells.eq(2)),
      listUrl: listHref ? new URL(listHref, BASE_URL).href : '',
    });
  });
  return placings;
}

// A decklist page by its URL, with English card names
async function scrapeList(listUrl) {
  return parseDecklist(await fetchPage(listUrl));
}

module.exports = { scrapeMetaDecks, scrapeSampleList, scrapeCityLeagues, scrapeCityLeague, scrapeList };
