// backend/services/receipt.service.js
const Receipt = require('../models/Receipt');

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
 * Определяет номер кассовой смены для чека с заданным временем.
 *   • если попадает в текущую открытую смену → её номер;
 *   • если timestamp исторический → ищем смену, покрывающую timestamp;
 *   • если ничего не нашли → номер текущей смены (fallback).
 * Явно переданный p.shiftNumber имеет приоритет.
 */
async function resolveShiftNumber(ts, currentShift, explicit) {
  if (explicit != null && Number.isInteger(Number(explicit))) return Number(explicit);
  if (!currentShift) return null;

  const t = ts.getTime();
  const opened = new Date(currentShift.openedAt).getTime();
  const closeAt = currentShift.autoCloseAt
    ? new Date(currentShift.autoCloseAt).getTime()
    : currentShift.closedAt
      ? new Date(currentShift.closedAt).getTime()
      : Infinity;

  if (t >= opened && t < closeAt) return currentShift.shiftNumber;

  if (ctx.Shift) {
    try {
      const hist = await ctx.Shift.findOne({
        openedAt: { $lte: ts },
        $or: [
          { closedAt: { $gte: ts } },
          { closedAt: null, autoCloseAt: { $gte: ts } },
          { closedAt: null, autoCloseAt: null },
        ],
      }).sort({ shiftNumber: -1 }).lean();
      if (hist) return hist.shiftNumber;
    } catch { /* ignore */ }
  }
  return currentShift.shiftNumber;
}

/**
 * Создаёт чек в БД.
 *
 * totalCost = ДЕНЬГИ, ПОЛУЧЕННЫЕ ИМЕННО ЭТИМ ЧЕКОМ (нетто).
 *
 * Приоритеты расчёта totalCost:
 *
 *   1) p.paymentAlreadyCounted === true → деньги уже учтены ранее
 *      (оплата картой клиента: реальные деньги пришли в кассу
 *      в момент пополнения карты, чек advance_card). Тогда:
 *        grossTotal     = rawTotal
 *        advanceApplied = rawTotal
 *        totalCost      = 0
 *
 *   2) kind === 'final' и передан advanceReceiptNumber → покрываем услугу
 *      открытыми АВАНСАМИ ПОСТА (advance_post / topup_post):
 *        grossTotal     = rawTotal
 *        advanceApplied = сумма открытых авансов
 *        totalCost      = max(0, grossTotal − advanceApplied)
 *      Применённые advance_post закрываются ссылкой finalReceiptNumber.
 *      ⚠️ advance_card / topup_card НЕ потребляются: это «кредит» на карте,
 *      он может оплачивать много разных сессий, закрывать его нельзя.
 *
 *   3) иначе → totalCost = rawTotal.
 *
 * @param {Object} p
 * @param {Number} p.postId
 * @param {String} p.kind              — 'session' | 'final' | 'advance_post' | 'advance_card' | 'transfer_post_to_card' | 'refund' | ...
 * @param {String} p.operation         — 'sell' | 'topup' | 'transfer' | 'refund' | ...
 * @param {Boolean} p.isAdvance
 * @param {Number} [p.advanceReceiptNumber] — подсказка для kind='final'; сервис сам найдёт все открытые авансы поста
 * @param {Boolean} [p.paymentAlreadyCounted] — true для оплаты картой клиента (деньги учтены при пополнении)
 * @param {String} [p.cardNumber]      — карта клиента (advance_card / final с оплатой картой)
 * @param {Array}  p.items
 * @param {Number} p.totalCost         — полная (gross) стоимость услуги / сумма пополнения
 * @param {Number} p.balanceAfter
 * @param {String} p.paymentMethod
 * @param {Number} [p.discountTotal]
 * @param {Date}   [p.timestamp]
 * @param {Number} [p.shiftNumber]     — явно задать номер смены (иначе вычисляется по timestamp)
 * @param {Object} [p.correctionInfo]
 * @returns {Promise<Receipt>}
 */
async function createReceipt(p) {
  let currentShift = null;
  if (typeof ctx.ensureOpenShift === 'function') {
    currentShift = await ctx.ensureOpenShift();
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

  const rawTotal = p.totalCost != null
    ? Number(p.totalCost)
    : roundedItems.reduce((s, i) => s + i.cost, 0);

  let grossTotal        = null;
  let advanceApplied    = 0;
  let totalCost         = rawTotal;
  let consumedAdvances  = [];

  // (2) Пытаемся покрыть услугу открытыми авансами ПОСТА
  if (p.kind === 'final' && Number(p.postId) > 0 && p.advanceReceiptNumber != null) {
    consumedAdvances = await Receipt.find({
      postId: Number(p.postId),
      isAdvance: true,
      finalReceiptNumber: null,
      kind: { $in: ['advance_post', 'topup_post'] },
      status: { $ne: 'void' },
    }).sort({ timestamp: 1 }).lean();

    if (consumedAdvances.length > 0) {
      const totalAdvance = consumedAdvances.reduce((s, a) => s + (Number(a.totalCost) || 0), 0);
      grossTotal     = Math.round(rawTotal * 100) / 100;
      advanceApplied = Math.round(totalAdvance * 100) / 100;
      totalCost      = Math.max(0, grossTotal - advanceApplied);
    }
  }

  // (1) Оплата картой клиента — деньги уже были учтены при пополнении карты
  if (grossTotal == null && p.paymentAlreadyCounted) {
    grossTotal     = Math.round(rawTotal * 100) / 100;
    advanceApplied = Math.round(rawTotal * 100) / 100;
    totalCost      = 0;
  }

  const receiptNumber = await getNextReceiptNumber();

  let ts = p.timestamp;
  if (!ts || ts === 'now' || isNaN(Date.parse(ts))) ts = new Date();
  else ts = new Date(ts);

  const shiftNumber = await resolveShiftNumber(ts, currentShift, p.shiftNumber);

  const receipt = await Receipt.create({
    receiptNumber,
    postId:        Number(p.postId) || 0,
    timestamp:     ts,
    shiftNumber,
    operation:     p.operation || 'sell',
    kind:          p.kind || 'session',
    isAdvance:     !!p.isAdvance,
    advanceReceiptNumber: p.advanceReceiptNumber ?? null,
    cardNumber:    p.cardNumber ? String(p.cardNumber).toUpperCase() : null,
    items:         roundedItems,
    totalCost:     Math.round(totalCost * 100) / 100,
    grossTotal:    grossTotal != null ? grossTotal : null,
    advanceApplied,
    balanceAfter:  Math.round((Number(p.balanceAfter) || 0) * 100) / 100,
    paymentMethod: p.paymentMethod || null,
    discountTotal: Number(p.discountTotal) || 0,
    status:        'done',
    correctionInfo: p.correctionInfo || null,
    fiscalSent:    false,
  });

  // Закрываем только применённые авансы ПОСТА
  if (consumedAdvances.length > 0) {
    await Receipt.updateMany(
      { _id: { $in: consumedAdvances.map(a => a._id) } },
      { $set: { finalReceiptNumber: receipt.receiptNumber } },
    ).catch(() => {});
  }

  try { await ctx.broadcastShiftTotal(); } catch { /* ignore */ }

  return receipt;
}

module.exports = {
  initReceiptService,
  createReceipt,
  getNextReceiptNumber,
};