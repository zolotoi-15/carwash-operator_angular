// backend/models/Receipt.js
const mongoose = require('mongoose');

const serviceLineSchema = new mongoose.Schema({
  name:           { type: String, default: '' },
  seconds:        { type: Number, default: 0 },
  cost:           { type: Number, default: 0 },
  pricePerSecond: { type: Number, default: 0 },
  discount:        { type: Number, default: 0 },
  discountPercent: { type: Number, default: 0 },
}, { _id: false });

const receiptSchema = new mongoose.Schema({
  receiptNumber: { type: Number, default: 0, index: true },
  postId:        { type: Number, default: 0, index: true },
  timestamp:     { type: Date,   default: Date.now, index: true },

  // Кассовая смена, к которой относится чек.
  // Проставляется автоматически в createReceipt по времени чека.
  // Именно по этому полю фильтруются отчёты «по номеру смены».
  shiftNumber:   { type: Number, default: null, index: true },

  operation:     { type: String, default: 'sell' },
  kind:          { type: String, default: 'session', index: true },

  items:         { type: [serviceLineSchema], default: [] },

  // totalCost = ДЕНЬГИ, ПОЛУЧЕННЫЕ ИМЕННО ЭТИМ ЧЕКОМ (нетто).
  //   • пополнение (advance_card / advance_post / topup_*) = сумма пополнения
  //   • финальный чек с авансом поста  = grossTotal − advanceApplied
  //   • финальный чек с оплатой картой = 0 (деньги учтены при пополнении карты)
  totalCost:     { type: Number, default: 0 },
  grossTotal:    { type: Number, default: null, index: true },
  advanceApplied:{ type: Number, default: 0, index: true },
  balanceAfter:  { type: Number, default: 0 },

  paymentMethod: { type: String, default: null, index: true },
  discountTotal: { type: Number, default: 0 },

  status:        { type: String, enum: ['done', 'void'], default: 'done', index: true },

  isAdvance: { type: Boolean, default: false, index: true },
  advanceReceiptNumber: { type: Number, default: null },
  finalReceiptNumber:   { type: Number, default: null },

  // Карта клиента (только для advance_card / final с оплатой картой / refund по карте).
  // Используется для отчёта GET /api/cards/:card/report.
  cardNumber: { type: String, default: null },

  fiscalSent:            { type: Boolean, default: false },
  fiscalUuid:            { type: String,  default: null },
  fiscalDocumentNumber:  { type: Number,  default: null },
  fiscalSign:            { type: String,  default: null },

  correctionInfo: {
    type:       { type: String, enum: ['self', 'instruction', null], default: null },
    baseDate:   { type: Date,   default: null },
    baseNumber: { type: String, default: null },
  },
}, { timestamps: true });

// ── Индексы ────────────────────────────────────────────────────────
receiptSchema.index({ postId: 1, timestamp: -1 });
receiptSchema.index({ kind: 1, timestamp: -1 });
receiptSchema.index({ paymentMethod: 1, timestamp: -1 });
receiptSchema.index({ isAdvance: 1, postId: 1, timestamp: -1 });
receiptSchema.index({ status: 1, timestamp: -1 });
receiptSchema.index({ shiftNumber: 1, timestamp: -1 });
receiptSchema.index({ cardNumber: 1, timestamp: -1 }, { sparse: true });
receiptSchema.index({ advanceReceiptNumber: 1 }, { sparse: true });
receiptSchema.index({ finalReceiptNumber: 1 },   { sparse: true });

module.exports = mongoose.model('Receipt', receiptSchema);