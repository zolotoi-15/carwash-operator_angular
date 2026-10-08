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

  // Тип операции: 'sell' | 'topup' | 'refund' | ...
  operation:     { type: String, default: 'sell' },

  // Тип чека:
  //   'session'       — обычная сессия
  //   'topup_card'    — пополнение карты клиента (без аванса, legacy)
  //   'topup_post'    — пополнение поста (без аванса, legacy)
  //   'advance_card'  — аванс: пополнение карты клиента
  //   'advance_post'  — аванс: пополнение поста
  //   'final'         — финальный чек, закрывающий аванс
  kind:          { type: String, default: 'session', index: true },

  items:         { type: [serviceLineSchema], default: [] },
  totalCost:     { type: Number, default: 0 },
  balanceAfter:  { type: Number, default: 0 },

  paymentMethod: { type: String, default: null, index: true },
  discountTotal: { type: Number, default: 0 },

  // ---------- Авансовые платежи ----------
  /** Признак авансового платежа (пополнение карты/поста) */
  isAdvance: { type: Boolean, default: false, index: true },

  /** Для финального чека: номер авансового чека, который он закрывает */
  advanceReceiptNumber: { type: Number, default: null, index: true },

  /** Для авансового чека: номер финального чека, которым он закрыт */
  finalReceiptNumber: { type: Number, default: null },

  // ---------- Фискальные поля ----------
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

receiptSchema.index({ postId: 1, timestamp: -1 });
receiptSchema.index({ kind: 1, timestamp: -1 });
receiptSchema.index({ paymentMethod: 1, timestamp: -1 });
receiptSchema.index({ isAdvance: 1, postId: 1, timestamp: -1 });

module.exports = mongoose.model('Receipt', receiptSchema);