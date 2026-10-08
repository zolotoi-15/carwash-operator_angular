// backend/routes/cards.js
const express = require('express');
const router = express.Router();
const ClientCard = require('../models/ClientCard');
const CardOperation = require('../models/CardOperation');

// ============================================================
// ВАЖНО: специфичные пути — ДО параметрических /:card
// ============================================================

// ---------- LIST ----------
router.get('/', async (_req, res) => {
  try {
    const cards = await ClientCard.find().sort({ createdAt: -1 });
    res.json(cards);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- SEARCH ----------
// GET /api/cards/search?q=...
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  try {
    const cards = await ClientCard.find({
      $or: [{ card: rx }, { fullName: rx }, { phone: rx }],
    }).limit(50);
    res.json(cards);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- CREATE ----------
router.post('/', async (req, res) => {
  const { card, type, fullName, phone } = req.body || {};
  if (!card || !type) {
    return res.status(400).json({ error: 'Поля card и type обязательны' });
  }
  if (!['client', 'operator', 'service'].includes(type)) {
    return res.status(400).json({ error: 'Недопустимый тип карты' });
  }
  try {
    const created = await ClientCard.create({
      card: String(card).toUpperCase(),
      type,
      balance: 0,
      fullName: fullName || '',
      phone: phone || '',
    });
    res.status(201).json(created);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Карта уже существует' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ---------- TOPUP BY NUMBER ----------
// POST /api/cards/by-number/:number/topup
router.post('/by-number/:number/topup', async (req, res) => {
  const num = Number(req.body?.amount);
  if (!num || num <= 0) {
    return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
  }
  const number = String(req.params.number || '').toUpperCase();
  try {
    const card = await ClientCard.findOneAndUpdate(
      { card: number },
      { $inc: { balance: num } },
      { new: true },
    );
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });

    await CardOperation.create({
      card: card.card,
      type: 'topup',
      amount: num,
      balanceAfter: card.balance,
      operatorName: req.user?.username || null,
      comment: 'Пополнение по номеру карты',
    }).catch(() => {});

    if (req.app.locals.publishCardBalanceToPosts) {
      req.app.locals.publishCardBalanceToPosts(card.card).catch(() => {});
    }

    res.json(card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- TOPUP FROM POST ----------
// POST /api/cards/:card/topup-from-post
router.post('/:card/topup-from-post', async (req, res) => {
  const { postId, amount } = req.body || {};
  const num = Number(amount);
  if (!num || num <= 0) {
    return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
  }
  const cardNumber = String(req.params.card || '').toUpperCase();
  try {
    const card = await ClientCard.findOneAndUpdate(
      { card: cardNumber },
      { $inc: { balance: num } },
      { new: true },
    );
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });

    await CardOperation.create({
      card: card.card,
      type: 'topup_from_post',
      amount: num,
      balanceAfter: card.balance,
      postId: postId != null ? String(postId) : null,
      comment: 'Перенос баланса с поста',
    }).catch(() => {});

    if (req.app.locals.publishCardBalanceToPosts) {
      req.app.locals.publishCardBalanceToPosts(card.card).catch(() => {});
    }

    console.log(`💳 [Post ${postId ?? '—'}] → карта ${card.card}: +${num} ₽ (итог ${card.balance})`);
    res.json(card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- TOPUP (manual) ----------
// POST /api/cards/:card/topup
router.post('/:card/topup', async (req, res) => {
  const num = Number(req.body?.amount);
  if (!num || num <= 0) {
    return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
  }
  const cardNumber = String(req.params.card || '').toUpperCase();
  try {
    const card = await ClientCard.findOneAndUpdate(
      { card: cardNumber },
      { $inc: { balance: num } },
      { new: true },
    );
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });

    await CardOperation.create({
      card: card.card,
      type: 'topup',
      amount: num,
      balanceAfter: card.balance,
      operatorName: req.user?.username || null,
      comment: 'Ручное пополнение оператором',
    }).catch(() => {});

    if (req.app.locals.publishCardBalanceToPosts) {
      req.app.locals.publishCardBalanceToPosts(card.card).catch(() => {});
    }

    res.json(card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- REPORT ----------
// GET /api/cards/:card/report?from=...&to=...
router.get('/:card/report', async (req, res) => {
  const cardNumber = String(req.params.card || '').toUpperCase();
  const filter = { card: cardNumber };
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }
  try {
    const operations = await CardOperation.find(filter).sort({ createdAt: -1 });
    const card = await ClientCard.findOne({ card: cardNumber });
    const summary = {
      balance: card?.balance ?? 0,
      totalTopUps: operations.filter(o => o.amount > 0).reduce((s, o) => s + o.amount, 0),
      totalCharges: operations.filter(o => o.amount < 0).reduce((s, o) => s + Math.abs(o.amount), 0),
      operationsCount: operations.length,
    };
    res.json({ summary, operations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- PATCH info ----------
// PATCH /api/cards/:card
router.patch('/:card', async (req, res) => {
  const cardNumber = String(req.params.card || '').toUpperCase();
  const update = {};
  if (typeof req.body?.fullName === 'string') update.fullName = req.body.fullName;
  if (typeof req.body?.phone === 'string') update.phone = req.body.phone;
  try {
    const card = await ClientCard.findOneAndUpdate({ card: cardNumber }, update, { new: true });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    res.json(card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- GET / DELETE (параметрические) ----------
router.get('/:card', async (req, res) => {
  try {
    const card = await ClientCard.findOne({ card: req.params.card.toUpperCase() });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    res.json(card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:card', async (req, res) => {
  try {
    const deleted = await ClientCard.findOneAndDelete({ card: req.params.card.toUpperCase() });
    if (!deleted) return res.status(404).json({ error: 'Карта не найдена' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;