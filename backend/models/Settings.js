const MqttSchema = new mongoose.Schema({
  // --- Локальный брокер (Aedes) ---
  localHost:     { type: String, default: '192.168.31.211' },
  localPortTcp:  { type: Number, default: 1883 },          // mqtt://
  localPortWs:   { type: Number, default: 8083 },          // ws://
  localPath:     { type: String, default: '/mqtt' },
  localUsername: { type: String, default: 'admin' },
  localPassword: { type: String, default: 'Zavulon56' },

  // --- Удалённый брокер (WQTT) ---
  remoteHost:     { type: String, default: 'm2.wqtt.ru' },
  remotePortTcp:  { type: Number, default: 13257 },
  remotePortTls:  { type: Number, default: 13258 },
  remotePortWss:  { type: Number, default: 13260 },
  remoteUsername: { type: String, default: 'u_GGENLB' },
  remotePassword: { type: String, default: 'LTHNW22D' },
}, { _id: false });

const SettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main' },
  mqtt: { type: MqttSchema, default: () => ({}) },
  // ... остальные поля
}, { strict: false, minimize: false, timestamps: true });