const fetch = require('./fetch');

// Loads a deck shared on PTCGTW (奶爸工作室, ptcgtw.shop) by its code, e.g. CQ94394, as found
// under deck images: "點擊圖片開啟 PTCGTW 牌組頁：CQ94394". This is the request PTCGTW's own
// page makes when it opens a shared deck; it isn't a published API, so it may change. It runs
// only when you import a deck, once per import.
//
// Each card comes with Chinese/Japanese names, the print (set, number, rarity) and the price
// at the Taiwan shop Kiwi PTCG for that print, which the import uses as a starting price.

const API_URL = 'https://ptcgtw.shop/index_function/api/23_01_load_deck_ptcgtw_api.php';
const CODE_RE = /^[A-Za-z0-9]{4,16}$/;

// Accepts the bare code or a PTCGTW link carrying it (…/index2.php?s=CQ94394)
function parseCode(input) {
  const raw = String(input ?? '').trim();
  if (CODE_RE.test(raw)) return raw.toUpperCase();
  try {
    const url = new URL(raw);
    const code = url.searchParams.get('s');
    if (/(^|\.)ptcgtw\.shop$/.test(url.hostname) && CODE_RE.test(code || '')) return code.toUpperCase();
  } catch {
    // Not a link either
  }
  throw new Error('請輸入 PTCGTW 牌組代碼（例如 CQ94394）或牌組連結');
}

function section(cardType) {
  if (/寶可夢/.test(cardType)) return 'pokemon';
  if (/能量/.test(cardType)) return 'energy';
  return 'trainer';
}

const clean = value => (value && value !== 'None' ? String(value).trim() : '');

function toCard(c) {
  const price = Number(c.price) > 0 ? Number(c.price) : null;
  let url = '';
  try {
    if (price != null && c.kiwi_link) url = new URL(c.kiwi_link).href;
  } catch {
    // A malformed shop link just isn't kept
  }
  return {
    name: clean(c.name_tw) || clean(c.name_jp) || clean(c.name_en),
    section: section(c.card_type || ''),
    print: [clean(c.set_name), clean(c.set_no), clean(c.rarity)].filter(Boolean).join(' ').slice(0, 40),
    quantity: Number(c['張數']) || 0,
    owned: 0,
    price,
    url,
  };
}

// The deck's main attacker as a default name: the Pokémon ex (or else Pokémon) you run most of
function guessName(cards) {
  const pokemon = cards.filter(c => c.section === 'pokemon');
  const pick = list => [...list].sort((a, b) => b.quantity - a.quantity)[0]?.name;
  return pick(pokemon.filter(c => /ex$/i.test(c.name))) || pick(pokemon) || '';
}

async function loadDeck(input) {
  const code = parseCode(input);
  const data = await fetch.post(API_URL, { code }, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    timeout: 20000,
  });
  if (!data?.success || !Array.isArray(data.deck)) {
    throw new Error(data?.message ? `PTCGTW：${data.message}` : `PTCGTW 找不到牌組 ${code}`);
  }
  const cards = data.deck.map(toCard).filter(c => c.name && c.quantity > 0);
  if (!cards.length) throw new Error(`PTCGTW 牌組 ${code} 是空的`);
  return { code, name: guessName(cards), cards };
}

module.exports = { loadDeck, parseCode };
