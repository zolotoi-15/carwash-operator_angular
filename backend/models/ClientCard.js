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
      match: /^[0-9A-F]+$/i,
    },
    name:  { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    balance: { type: Number, default: 0, min: 0 },
    type: {
      type: String,
      enum: ['client', 'operator', 'service'],
      required: true,
      default: 'client',
    },
  },
  {
    timestamps: true,
    collection: 'clientsCard',
    toJSON: {
      versionKey: false,
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        ret.number = ret.card;
        delete ret._id;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('ClientCard', clientCardSchema);