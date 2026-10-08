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

  operation:     { type: String, default: 'sell' },   // 'sell' | 'topup_card' | 'topup_post' | ...
  kind:          { type: String, default: 'session' }, // 'session' | 'topup_card' | 'topup_post'

  items:         { type: [serviceLineSchema], default: [] },
  totalCost:     { type: Number, default: 0 },
  balanceAfter:  { type: Number, default: 0 },

  paymentMethod: { type: String, default: null, index: true }, // 'cash' | 'card_terminal' | 'client_card'
  discountTotal: { type: Number, default: 0 },

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

module.exports = mongoose.model('Receipt', receiptSchema);