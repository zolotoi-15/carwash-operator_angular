// backend/models/ClientCard.js
const mongoose = require('mongoose');

const clientCardSchema = new mongoose.Schema(
  {
    card: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: /^[0-9A-F]+$/i
    },
    balance: { type: Number, default: 0, min: 0 },
    type: {
      type: String,
      enum: ['client', 'operator', 'service'],
      required: true,
      default: 'client'
    },
    fullName: { type: String, default: '' },
    phone: { type: String, default: '' },
  },
  { timestamps: true, collection: 'clientsCard' }
);

module.exports = mongoose.model('ClientCard', clientCardSchema);