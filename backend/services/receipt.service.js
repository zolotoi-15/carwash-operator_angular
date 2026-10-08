// backend/services/receipt.service.js
const Receipt = require('../models/Receipt');

/**
 * Контекст, который прокидывает server.js, чтобы не тянуть циклические зависимости.
 * server.js при старте вызывает initReceiptService({ Counter, Shift, broadcastShiftTotal, publishKkmStatus })
 */
let ctx = {
  Counter: null,
  Shift: null,
  broadcastShiftTotal: async () => {},
  publishKkmStatus: async () => {},
  ensureOpenShift: null,
};

function initReceiptService(deps) {
  ctx = { ...ctx, ...deps };
}

async function getNextReceiptNumber() {
  const c = await ctx.Counter.findOneAndUpdate(
    { _id: 'receiptNumber' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return c.seq;
}

/**
 * Создаёт чек в БД. Автоматически открывает смену при необходимости.
 *
 * @param {Object} p
 * @param {Number} p.postId            — 0 для пополнения карты, >0 для поста
 * @param {String} p.kind              — 'session' | 'topup_card' | 'topup_post'
 * @param {String} p.operation         — 'sell' | 'topup' | ...
 * @param {Array}  p.items             — [{ name, seconds, cost, pricePerSecond, discount, discountPercent }]
 * @param {Number} p.totalCost
 * @param {Number} p.balanceAfter
 * @param {String} p.paymentMethod     — 'cash' | 'card_terminal' | 'client_card' | null
 * @param {Number} [p.discountTotal]
 * @param {Date}   [p.timestamp]
 * @param {Object} [p.correctionInfo]
 * @returns {Promise<Receipt>}
 */
async function createReceipt(p) {
  if (typeof ctx.ensureOpenShift === 'function') {
    await ctx.ensureOpenShift();
  }

  const items = Array.isArray(p.items) ? p.items : [];
  const roundedItems = items.map(it => ({
    name:            it.name || 'Услуга',
    seconds:         Math.round((Number(it.seconds) || 0) * 10) / 10,
    cost:            Math.round((Number(it.cost) || 0) * 100) / 100,
    pricePerSecond:  Math.round((Number(it.pricePerSecond) || 0) * 100) / 100,
    discount:        Number(it.discount) || 0,
    discountPercent: Number(it.discountPercent) || 0,
  }));

  const totalCost = p.totalCost != null
    ? Number(p.totalCost)
    : roundedItems.reduce((s, i) => s + i.cost, 0);

  const receiptNumber = await getNextReceiptNumber();

  let ts = p.timestamp;
  if (!ts || ts === 'now' || isNaN(Date.parse(ts))) ts = new Date();
  else ts = new Date(ts);

  const receipt = await Receipt.create({
    receiptNumber,
    postId:        Number(p.postId) || 0,
    timestamp:     ts,
    operation:     p.operation || 'sell',
    kind:          p.kind || 'session',
    items:         roundedItems,
    totalCost:     Math.round(totalCost * 100) / 100,
    balanceAfter:  Math.round((Number(p.balanceAfter) || 0) * 100) / 100,
    paymentMethod: p.paymentMethod || null,
    discountTotal: Number(p.discountTotal) || 0,
    correctionInfo: p.correctionInfo || null,
    fiscalSent:    false,
  });

  try { await ctx.broadcastShiftTotal(); } catch { /* ignore */ }

  return receipt;
}

module.exports = {
  initReceiptService,
  createReceipt,
  getNextReceiptNumber,
};