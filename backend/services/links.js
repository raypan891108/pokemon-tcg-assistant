const crypto = require('crypto');
const storage = require('./storage');

// Your list of useful Pokémon TCG websites, in groups, edited on the 相關網站 page.
// Saved whole on every change: { groups: [{ id, name, links: [{ id, name, url, note }] }] }

const MAX_GROUPS = 30;
const MAX_LINKS = 100;

// First visit only; after that the page shows whatever you've saved
const DEFAULT_GROUPS = [
  {
    name: '🏛️ 官方網站',
    links: [
      { name: '訓練家網站（台灣官網）', url: 'https://asia.pokemon-card.com/tw/', note: '商品、活動、比賽公告' },
      { name: '寶可夢亞洲錦標賽系列', url: 'https://trainers-asia.portal-pokemon.com/tw/', note: '聯盟賽報名' },
      { name: 'デッキ構築｜ポケモンカードゲーム公式', url: 'https://www.pokemon-card.com/deck/', note: '日本官方組牌工具' },
    ],
  },
  {
    name: '🃏 牌組與卡表',
    links: [
      { name: 'PokecaBook', url: 'https://pokecabook.com/', note: '日本牌組與環境整理' },
      { name: '奶爸工作室｜PTCG 繁體中文工具箱', url: 'https://ptcgtw.shop/', note: '繁中卡表生成器、日本牌組整理' },
      { name: 'ポケカードラボ', url: 'https://pokecardlab.com/', note: '日本牌組食譜，7,000 種以上' },
    ],
  },
  {
    name: '💹 卡價與買賣',
    links: [
      { name: '遊々亭', url: 'https://yuyu-tei.jp/', note: '日本單卡價格' },
    ],
  },
  {
    name: '🛠️ 工具',
    links: [
      { name: 'PTCG 對戰模擬器', url: 'https://www.ptcg-tw-sim.com/tournament', note: '卡牌資料庫、線上對戰與錦標賽' },
    ],
  },
  {
    name: '🕹️ 網頁遊戲',
    links: [
      { name: 'PokéSurvivor 繁體中文版', url: 'https://pokesurvivor.co/zh-Hant/', note: '免費線上寶可夢生存遊戲' },
    ],
  },
];

const newId = () => crypto.randomBytes(6).toString('hex');

function withIds(groups) {
  return groups.map(g => ({ id: newId(), ...g, links: g.links.map(l => ({ id: newId(), ...l })) }));
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);

function cleanUrl(value) {
  const raw = text(value, 2000);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`網址格式不正確：${raw || '（空白）'}`);
  }
  // Only web pages: a javascript: or data: link would run code when clicked
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`只能放 http 或 https 網址：${raw}`);
  return url.href;
}

// Rebuilt field by field, so only known fields are stored and ids stay unique
function validate(body) {
  if (!Array.isArray(body?.groups)) throw new Error('資料格式不正確');
  if (body.groups.length > MAX_GROUPS) throw new Error(`最多 ${MAX_GROUPS} 個分組`);
  const seen = new Set();
  const uniqueId = id => {
    const clean = /^[\w-]{1,40}$/.test(id) && !seen.has(id) ? id : newId();
    seen.add(clean);
    return clean;
  };
  let total = 0;
  const groups = body.groups.map(g => {
    const name = text(g.name, 40);
    if (!name) throw new Error('分組名稱不能空白');
    const links = (Array.isArray(g.links) ? g.links : []).map(l => {
      const linkName = text(l.name, 80);
      if (!linkName) throw new Error('網站名稱不能空白');
      return { id: uniqueId(l.id), name: linkName, url: cleanUrl(l.url), note: text(l.note, 120) };
    });
    total += links.length;
    return { id: uniqueId(g.id), name, links };
  });
  if (total > MAX_LINKS) throw new Error(`最多 ${MAX_LINKS} 個連結`);
  return { groups };
}

async function get() {
  const saved = await storage.getLinks();
  return saved || { groups: withIds(DEFAULT_GROUPS) };
}

async function save(body) {
  const data = validate(body);
  await storage.saveLinks(data);
  return data;
}

module.exports = { get, save };
