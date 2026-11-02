const crypto = require('crypto');
const storage = require('./storage');

const STATUSES = ['in_stock', 'listed', 'sold'];
const TEXT_FIELDS = ['name', 'cardNumber', 'set', 'language', 'rarity', 'condition', 'imageUrl', 'marketId', 'purchasedAt', 'soldAt', 'notes'];
const NUMBER_FIELDS = ['quantity', 'cost', 'listPrice', 'soldPrice', 'fee', 'shipping'];

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
  return item;
}

// cost / listPrice / soldPrice are per card; fee and shipping are totals for the lot
function withProfit(item) {
  const qty = item.quantity || 0;
  const totalCost = (item.cost || 0) * qty;
  const revenue = item.status === 'sold' && item.soldPrice != null ? item.soldPrice * qty : null;
  const profit = revenue != null ? revenue - (item.fee || 0) - (item.shipping || 0) - totalCost : null;
  return { ...item, totalCost, revenue, profit };
}

function defaultFee(soldPrice, quantity) {
  const rate = Number(storage.getSettings().kapaipaiFeeRate) || 0;
  return Math.round(soldPrice * quantity * rate / 100);
}

function list() {
  return storage.getInventory().map(withProfit);
}

function validateQuantity(data) {
  if (data.quantity == null) return;
  if (!Number.isInteger(data.quantity) || data.quantity < 1) throw new Error('數量需為 1 以上的整數');
}

function create(input) {
  const data = sanitize(input);
  if (!data.name) throw new Error('卡名為必填');
  validateQuantity(data);
  const now = new Date().toISOString();
  const item = {
    status: 'in_stock',
    ...data,
    quantity: data.quantity || 1,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const items = storage.getInventory();
  items.unshift(item);
  storage.saveInventory(items);
  return withProfit(item);
}

function update(id, input) {
  const items = storage.getInventory();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return null;
  const data = sanitize(input);
  if (data.name === '') throw new Error('卡名為必填');
  validateQuantity(data);
  if (data.quantity === null) delete data.quantity;
  items[idx] = { ...items[idx], ...data, updatedAt: new Date().toISOString() };
  storage.saveInventory(items);
  return withProfit(items[idx]);
}

function remove(id) {
  const items = storage.getInventory();
  const next = items.filter(i => i.id !== id);
  if (next.length === items.length) return false;
  storage.saveInventory(next);
  return true;
}

// Mark some or all of a lot as sold. Selling part of a lot splits it:
// the sold cards become a new record and the rest stay in the original one.
function sell(id, input) {
  const items = storage.getInventory();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return null;
  const item = items[idx];

  const data = sanitize(input);
  const quantity = data.quantity || item.quantity;
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > item.quantity) throw new Error('售出數量不正確');
  if (data.soldPrice == null) throw new Error('請輸入成交價');

  const now = new Date().toISOString();
  const sold = {
    ...item,
    quantity,
    soldPrice: data.soldPrice,
    fee: data.fee != null ? data.fee : defaultFee(data.soldPrice, quantity),
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
  storage.saveInventory(items);
  return withProfit(record);
}

module.exports = { list, create, update, remove, sell };
