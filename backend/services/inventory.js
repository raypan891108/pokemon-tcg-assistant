const crypto = require('crypto');
const storage = require('./storage');
const media = require('./media');

const STATUSES = ['in_stock', 'listed', 'sold'];
// Which warehouse an item is in: 賣場倉庫 (卡拍拍) or 網拍倉庫 (other online sales).
// Items saved before there were two have no channel and belong to 卡拍拍.
const CHANNELS = ['kapaipai', 'auction'];
const FEE_RATE_SETTING = { kapaipai: 'kapaipaiFeeRate', auction: 'auctionFeeRate' };
// What's being sold: a single card, sealed product, supplies (sleeves, deck boxes, playmats)
// or anything else. Items saved before this have no type and are single cards.
const ITEM_TYPES = ['card', 'sealed', 'supply', 'other'];
const channelOf = item => (CHANNELS.includes(item.channel) ? item.channel : 'kapaipai');
const TEXT_FIELDS = ['name', 'cardNumber', 'set', 'language', 'rarity', 'condition', 'imageUrl', 'marketId', 'purchasedAt', 'soldAt', 'notes', 'platform', 'listingUrl'];
// costCny: what you paid per card in 人民幣, with the rate (NT$ per 1 元) used to turn it
// into cost; cost (NT$) is what profit is worked out from
// feeRate: the 手續費 % a sale was charged at (to 3 decimals); fee is the NT$ amount
const NUMBER_FIELDS = ['quantity', 'cost', 'costCny', 'cnyRate', 'listPrice', 'soldPrice', 'fee', 'feeRate', 'shipping'];

// Every read-modify-write of inventory.json runs in turn: a long upload, an edit in another
// tab and a sale can otherwise each save their own copy and lose the others' changes
let queue = Promise.resolve();
function locked(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Keep only known fields, coerce numbers; blank numbers become null
function sanitize(input) {
  const item = {};
  for (const f of TEXT_FIELDS) {
    if (input[f] !== undefined) item[f] = input[f] === null ? null : String(input[f]).trim();
  }
  for (const f of NUMBER_FIELDS) {
    if (input[f] === undefined) continue;
    const n = input[f] === '' || input[f] === null ? null : Number(input[f]);
    item[f] = Number.isFinite(n) ? n : null;
  }
  if (input.status !== undefined && STATUSES.includes(input.status)) item.status = input.status;
  if (input.channel !== undefined && CHANNELS.includes(input.channel)) item.channel = input.channel;
  if (input.itemType !== undefined && ITEM_TYPES.includes(input.itemType)) item.itemType = input.itemType;
  // Only a web page can be the listing link (a javascript: link would run code when clicked)
  if (item.listingUrl && !/^https?:\/\//i.test(item.listingUrl)) throw new Error('上架網址需為 http 或 https 開頭');
  return item;
}

// cost / listPrice / soldPrice are per card; fee and shipping are totals for the lot
function withProfit(item) {
  const qty = item.quantity || 0;
  const totalCost = (item.cost || 0) * qty;
  const revenue = item.status === 'sold' && item.soldPrice != null ? item.soldPrice * qty : null;
  const profit = revenue != null ? revenue - (item.fee || 0) - (item.shipping || 0) - totalCost : null;
  return { ...item, channel: channelOf(item), itemType: ITEM_TYPES.includes(item.itemType) ? item.itemType : 'card', totalCost, revenue, profit };
}

// Fees are kept to the cent, so a small sale at a fractional rate isn't rounded to nothing
const feeFor = (soldPrice, quantity, rate) => Math.round(soldPrice * quantity * rate) / 100;

async function defaultFeeRate(channel) {
  return Number((await storage.getSettings())[FEE_RATE_SETTING[channel]]) || 0;
}

// One warehouse's items, or all of them when no channel is given
async function list(channel) {
  const items = (await storage.getInventory()).map(withProfit);
  return CHANNELS.includes(channel) ? items.filter(i => i.channel === channel) : items;
}

function validateQuantity(data) {
  if (data.quantity == null) return;
  if (!Number.isInteger(data.quantity) || data.quantity < 1) throw new Error('數量需為 1 以上的整數');
}

const create = input => locked(async () => {
  const data = sanitize(input);
  if (!data.name) throw new Error('名稱為必填');
  validateQuantity(data);
  const now = new Date().toISOString();
  const item = {
    status: 'in_stock',
    channel: 'kapaipai',
    ...data,
    quantity: data.quantity || 1,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const items = await storage.getInventory();
  items.unshift(item);
  await storage.saveInventory(items);
  return withProfit(item);
});

const update = (id, input) => locked(async () => {
  const items = await storage.getInventory();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return null;
  const data = sanitize(input);
  if (data.name === '') throw new Error('名稱為必填');
  validateQuantity(data);
  if (data.quantity === null) delete data.quantity;
  items[idx] = { ...items[idx], ...data, updatedAt: new Date().toISOString() };
  await storage.saveInventory(items);
  return withProfit(items[idx]);
});

const remove = id => locked(async () => {
  const items = await storage.getInventory();
  const item = items.find(i => i.id === id);
  if (!item) return false;
  const next = items.filter(i => i.id !== id);
  await storage.saveInventory(next);
  await media.removeUnused((item.media || []).map(m => m.file), next);
  return true;
});

// A photo or video for an item: the upload streams to disk outside the lock (it can take
// minutes), then it's recorded on the item inside it. null when the item doesn't exist
// (checked before the upload starts, and again after).
async function addMedia(id, req) {
  if (!(await storage.getInventory()).some(i => i.id === id)) return null;
  const entry = await media.save(req);
  return locked(() => recordMedia(id, entry));
}

async function recordMedia(id, entry) {
  const items = await storage.getInventory();
  const item = items.find(i => i.id === id);
  if (!item) {
    await media.removeUnused([entry.file], items);
    return null;
  }
  item.media = [...(item.media || []), entry];
  item.updatedAt = new Date().toISOString();
  await storage.saveInventory(items);
  return withProfit(item);
}

const removeMedia = (id, mediaId) => locked(async () => {
  const items = await storage.getInventory();
  const item = items.find(i => i.id === id);
  const entry = item?.media?.find(m => m.id === mediaId);
  if (!entry) return null;
  item.media = item.media.filter(m => m.id !== mediaId);
  item.updatedAt = new Date().toISOString();
  await storage.saveInventory(items);
  await media.removeUnused([entry.file], items);
  return withProfit(item);
});

// Mark some or all of a lot as sold. Selling part of a lot splits it:
// the sold cards become a new record and the rest stay in the original one.
const sell = (id, input) => locked(async () => {
  const items = await storage.getInventory();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return null;
  const item = items[idx];

  const data = sanitize(input);
  const quantity = data.quantity || item.quantity;
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > item.quantity) throw new Error('售出數量不正確');
  if (data.soldPrice == null) throw new Error('請輸入成交價');
  if (data.feeRate != null && !(data.feeRate >= 0 && data.feeRate <= 100)) throw new Error('手續費率需在 0～100% 之間');
  // An NT$ fee typed in wins; otherwise the rate from the form, or the one in 設定
  const feeRate = data.fee != null ? null
    : Math.round((data.feeRate != null ? data.feeRate : await defaultFeeRate(channelOf(item))) * 1000) / 1000;

  const now = new Date().toISOString();
  const sold = {
    ...item,
    quantity,
    soldPrice: data.soldPrice,
    fee: data.fee != null ? data.fee : feeFor(data.soldPrice, quantity, feeRate),
    feeRate,
    shipping: data.shipping != null ? data.shipping : 0,
    soldAt: data.soldAt || now.split('T')[0],
    status: 'sold',
    updatedAt: now,
  };

  let record = sold;
  if (quantity < item.quantity) {
    record = { ...sold, id: crypto.randomUUID(), createdAt: now };
    items[idx] = { ...item, quantity: item.quantity - quantity, updatedAt: now };
    items.splice(idx, 0, record);
  } else {
    items[idx] = sold;
  }
  await storage.saveInventory(items);
  return withProfit(record);
});

module.exports = { list, create, update, remove, sell, addMedia, removeMedia };
