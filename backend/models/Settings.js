// backend/models/Settings.js
// ВНИМАНИЕ: этот файл НЕ используется server.js.
// server.js определяет инлайн-схему Setting с { key, value } (см. server.js, строки ~423-450).
// Оставлен для справки / возможного будущего перехода.

const mongoose = require('mongoose');

// ---------- Схема локального брокера ----------
const LocalMqttSchema = new mongoose.Schema({
  host:     { type: String, default: '192.168.31.211' },
  portTcp:  { type: Number, default: 1883 },   // mqtt://
  portWs:   { type: Number, default: 8083 },   // ws://
  path:     { type: String, default: '/mqtt' },
  username: { type: String, default: 'admin' },
  password: { type: String, default: 'Zavulon56' },
}, { _id: false });

// ---------- Схема удалённого брокера (WQTT) ----------
const RemoteMqttSchema = new mongoose.Schema({
  host:     { type: String, default: 'm2.wqtt.ru' },
  portTcp:  { type: Number, default: 13257 },
  portTls:  { type: Number, default: 13258 },
  portWss:  { type: Number, default: 13260 },
  username: { type: String, default: 'u_GGENLB' },
  password: { type: String, default: 'LTHNW22D' },
}, { _id: false });

// ---------- Общая схема MQTT ----------
const MqttSchema = new mongoose.Schema({
  local:  { type: LocalMqttSchema,  default: () => ({}) },
  remote: { type: RemoteMqttSchema, default: () => ({}) },

  // Устаревшие поля (legacy) — для совместимости
  brokerUrl: String,
  username:  String,
  password:  String,
}, { _id: false });

// ---------- Основная схема настроек ----------
const SettingsSchema = new mongoose.Schema({
  key:  { type: String, unique: true, default: 'main' },
  mqtt: { type: MqttSchema, default: () => ({}) },
  // Остальные поля описывать не обязательно — strict: false
}, {
  strict: false,
  minimize: false,
  timestamps: true,
});

module.exports = mongoose.model('Settings', SettingsSchema);