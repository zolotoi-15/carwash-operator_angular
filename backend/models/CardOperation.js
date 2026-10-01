// backend/models/CardOperation.js
const mongoose = require('mongoose');

const cardOperationSchema = new mongoose.Schema({
  card: { type: String, required: true, index: true, uppercase: true },
  type: {
    type: String,
    required: true,
    enum: ['topup', 'charge', 'topup_from_post', 'refund', 'adjustment'],
  },
  amount: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  postId: { type: String, default: null },
  receiptNumber: { type: String, default: null },
  operatorName: { type: String, default: null },
  comment: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
});

cardOperationSchema.index({ card: 1, createdAt: -1 });

module.exports = mongoose.model('CardOperation', cardOperationSchema);