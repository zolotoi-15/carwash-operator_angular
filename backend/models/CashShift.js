// backend/models/CashShift.js
const mongoose = require('mongoose');

const cashShiftSchema = new mongoose.Schema({
  openedAt: { type: Date, required: true },
  closedAt: { type: Date, default: null },
  openedBy: { type: String, default: 'system' },
  closedBy: { type: String, default: null },
  status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
  autoClosed: { type: Boolean, default: false },
  openingBalance: { type: Number, default: 0 },
  closingBalance: { type: Number, default: 0 },
  totalCash: { type: Number, default: 0 },
  totalCard: { type: Number, default: 0 },
  totalClientCard: { type: Number, default: 0 },
});

module.exports = mongoose.model('CashShift', cashShiftSchema);