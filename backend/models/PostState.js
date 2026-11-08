// backend/models/PostState.js
const mongoose = require('mongoose');

const PostStateSchema = new mongoose.Schema(
  {
    postId: { type: Number, required: true, unique: true, index: true },

    // ★ Баланс поста — «истина» для transfer-to-card и /topup.
    //   Обновляется сервером при /topup и /transfer-to-card.
    //   ESP32 может присылать свой счётчик в status.balance — он НЕ
    //   перезаписывает это поле напрямую (см. server.js, MQTT handler).
    balance: { type: Number, default: 0 },

    // Состояние, приходящее от ESP32 (только чтение для фронта)
    busy:            { type: Boolean, default: false },
    paused:          { type: Boolean, default: false },
    currentProgram:  { type: String,  default: '-' },
    online:          { type: Boolean, default: false },

    // Номер авансового чека, выданного на пост (обнуляется на бэке)
    currentAdvanceReceiptNumber: { type: Number, default: null },

    lastSeen:  { type: Number, default: null },
    updatedAt: { type: Date,   default: Date.now },
  },
  { collection: 'post_states' }
);

module.exports = mongoose.model('PostState', PostStateSchema);