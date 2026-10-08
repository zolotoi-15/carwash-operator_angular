// backend/models/Receipt.js
const mongoose = require('mongoose');

const serviceLineSchema = new mongoose.Schema({
  name:           { type: String, default: '' },
  pricePerSecond: { type: Number, default: 0 },
  seconds:        { type: Number, default: 0 },
  total:          { type: Number, default: 0 },
}, { _id: false });

const receiptSchema = new mongoose.Schema({
  receiptNumber: { type: Number, default: 0, index: true },
  postId:        { type: Number, required: true, index: true },
  date:          { type: Date,   default: Date.now, index: true },
  total:         { type: Number, default: 0 },
  services:      { type: [serviceLineSchema], default: [] },
  fiscal:        { type: Boolean, default: false },
}, { timestamps: true });

// составные индексы — под частые запросы отчётов
receiptSchema.index({ postId: 1, date: -1 });
receiptSchema.index({ date: -1 });

module.exports = mongoose.model('Receipt', receiptSchema);