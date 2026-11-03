// backend/controllers/cardsController.js
const ClientCard = require('../models/ClientCard');
const CardOperation = require('../models/CardOperation');

exports.list = async (_req, res) => {
  try { res.json(await ClientCard.find().sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getByCard = async (req, res) => {
  try {
    const card = await ClientCard.findOne({ card: req.params.card.toUpperCase() });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    res.json(card);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.create = async (req, res) => {
  const { card, type, fullName, phone } = req.body || {};
  if (!card || !type) return res.status(400).json({ error: 'Поля card и type обязательны' });
  try {
    const created = await ClientCard.create({
      card: String(card).toUpperCase(), type, balance: 0,
      fullName: fullName || '', phone: phone || '',
    });
    res.status(201).json(created);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Карта уже существует' });
    res.status(500).json({ error: e.message });
  }
};

exports.topUp = async (req, res) => {
  const num = Number(req.body?.amount);
  if (!num || num <= 0) return res.status(400).json({ error: 'Сумма должна быть > 0' });
  try {
    const card = await ClientCard.findOneAndUpdate(
      { card: req.params.card.toUpperCase() },
      { $inc: { balance: num } },
      { new: true }
    );
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    await CardOperation.create({
      card: card.card, type: 'topup', amount: num,
      balanceAfter: card.balance, operatorName: req.user?.username || null,
    }).catch(() => {});
    if (req.app.locals.publishCardBalanceToPosts) {
      req.app.locals.publishCardBalanceToPosts(card.card).catch(() => {});
    }
    res.json(card);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.topUpFromPost = async (req, res) => {
  const { postId, amount } = req.body || {};
  const num = Number(amount);
  if (!num || num <= 0) return res.status(400).json({ error: 'Сумма должна быть > 0' });
  try {
    const card = await ClientCard.findOneAndUpdate(
      { card: req.params.card.toUpperCase() },
      { $inc: { balance: num } },
      { new: true }
    );
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    await CardOperation.create({
      card: card.card, type: 'topup_from_post', amount: num,
      balanceAfter: card.balance, postId: postId != null ? String(postId) : null,
    }).catch(() => {});
    if (req.app.locals.publishCardBalanceToPosts) {
      req.app.locals.publishCardBalanceToPosts(card.card).catch(() => {});
    }
    res.json(card);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.remove = async (req, res) => {
  try {
    const deleted = await ClientCard.findOneAndDelete({ card: req.params.card.toUpperCase() });
    if (!deleted) return res.status(404).json({ error: 'Карта не найдена' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.search = async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  try {
    res.json(await ClientCard.find({
      $or: [{ card: rx }, { fullName: rx }, { phone: rx }]
    }).limit(50));
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.report = async (req, res) => {
  const cardNumber = req.params.card.toUpperCase();
  try {
    const operations = await CardOperation.find({ card: cardNumber }).sort({ createdAt: -1 });
    const card = await ClientCard.findOne({ card: cardNumber });
    res.json({
      summary: {
        balance: card?.balance ?? 0,
        totalTopUps: operations.filter(o => o.amount > 0).reduce((s, o) => s + o.amount, 0),
        totalCharges: operations.filter(o => o.amount < 0).reduce((s, o) => s + Math.abs(o.amount), 0),
        operationsCount: operations.length,
      },
      operations,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
};