// backend/routes/cards.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const ClientCard = require('../models/ClientCard');
const Receipt = require('../models/Receipt');

// ── Auth middleware (совместим с server.js) ─────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization?.split(' ')[1];
  const query  = typeof req.query.token === 'string' ? req.query.token : null;
  const token  = header || query;
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'secretkey'); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'developer') {
    return res.status(403).json({ error: 'Admin required' });
  }
  next();
}

// ── Список карт ─────────────────────────────────────────────────────
// GET /api/cards                      → массив (для *ngFor)
// GET /api/cards?paginated=true&…     → { cards, total, page, limit }
// GET /api/cards?page=1&limit=50      → то же (пагинация по факту)
// X-Total-Count отдаётся всегда.
router.get('/', auth, async (req, res) => {
  try {
    const { search, page, limit, type, paginated } = req.query;

    const filter = {};
    if (search) {
      filter.$or = [
        { card:  new RegExp(String(search).trim(), 'i') },
        { owner: new RegExp(String(search).trim(), 'i') },
        { phone: new RegExp(String(search).trim(), 'i') },
      ];
    }
    if (type) filter.type = type;

    const wantsPagination =
      paginated === 'true' || paginated === '1' ||
      page !== undefined || limit !== undefined;

    if (!wantsPagination) {
      const cards = await ClientCard.find(filter).sort({ card: 1 }).lean();
      res.setHeader('X-Total-Count', String(cards.length));
      return res.json(cards);
    }

    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(500, Math.max(1, Number(limit) || 50));
    const [cards, total] = await Promise.all([
      ClientCard.find(filter).sort({ card: 1 }).skip((p - 1) * l).limit(l).lean(),
      ClientCard.countDocuments(filter),
    ]);
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('X-Page', String(p));
    res.setHeader('X-Limit', String(l));
    res.json({ cards, total, page: p, limit: l });
  } catch (err) {
    console.error('❌ GET /api/cards:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Одна карта ──────────────────────────────────────────────────────
router.get('/:card', auth, async (req, res) => {
  try {
    const card = await ClientCard.findOne({ card: String(req.params.card).toUpperCase() });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Отчёт по карте ──────────────────────────────────────────────────
// GET /api/cards/:card/report
//   без параметров            — все операции карты
//   ?shiftNumber=N            — только по смене N
//   ?from=ISO&to=ISO          — только за период
//   ?limit=100&page=1         — пагинация списка (summary считается по всем)
// В отчёт попадают:
//   • advance_card / refund  — пополнения и возвраты (приход/расход)
//   • final, оплаченные картой — стоимость услуг (grossTotal)
router.get('/:card/report', auth, async (req, res) => {
  try {
    const cardNumber = String(req.params.card || '').trim().toUpperCase();
    const card = await ClientCard.findOne({ card: cardNumber }).lean();
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });

    const { shiftNumber, from, to, limit = 100, page = 1 } = req.query;

    const filter = { cardNumber, status: { $ne: 'void' } };
    if (shiftNumber != null && shiftNumber !== '') {
      const n = Number(shiftNumber);
      if (!Number.isInteger(n)) return res.status(400).json({ error: 'Некорректный shiftNumber' });
      filter.shiftNumber = n;
    } else if (from && to) {
      const start = new Date(from); const end = new Date(to);
      if (isNaN(start) || isNaN(end)) return res.status(400).json({ error: 'Некорректные from/to' });
      filter.timestamp = { $gte: start, $lte: end };
    }

    const allOps = await Receipt.find(filter).sort({ timestamp: -1 }).lean();

    const operations = allOps.map(r => {
      const isInflow   = r.isAdvance === true || r.operation === 'topup';
      const totalCost  = Number(r.totalCost) || 0;
      const grossTotal = r.grossTotal != null ? Number(r.grossTotal) : null;

      let description;
      if (r.kind === 'advance_card')      description = 'Пополнение карты';
      else if (r.kind === 'refund')       description = 'Возврат / корректировка';
      else if (r.kind === 'final')        description = 'Оплата услуг';
      else                                description = r.kind || 'Операция';

      const displayAmount =
        r.kind === 'final'
          ? (grossTotal ?? (Number(r.advanceApplied) || totalCost))
          : totalCost;

      return {
        receiptNumber: r.receiptNumber,
        timestamp:     r.timestamp,
        shiftNumber:   r.shiftNumber ?? null,
        postId:        r.postId,
        kind:          r.kind,
        operation:     r.operation,
        isInflow,
        amount:        Math.round(totalCost * 100) / 100,
        displayAmount: Math.round(displayAmount * 100) / 100,
        balanceAfter:  Math.round((Number(r.balanceAfter) || 0) * 100) / 100,
        paymentMethod: r.paymentMethod || null,
        description,
        items: (r.items || []).map(it => ({
          name:    it.name || '',
          seconds: Number(it.seconds) || 0,
          cost:    Number(it.cost) || 0,
        })),
      };
    });

    const totalTopups = operations
      .filter(o => o.isInflow)
      .reduce((s, o) => s + o.amount, 0);
    const totalSpent = operations
      .filter(o => !o.isInflow && o.kind === 'final')
      .reduce((s, o) => s + o.displayAmount, 0);

    const l = Math.min(1000, Math.max(1, Number(limit) || 100));
    const p = Math.max(1, Number(page) || 1);
    const pageOps = operations.slice((p - 1) * l, p * l);

    res.json({
      card: {
        card:    card.card,
        owner:   card.owner || '',
        phone:   card.phone || '',
        type:    card.type || 'standard',
        balance: card.balance || 0,
      },
      filter: shiftNumber
        ? { shiftNumber: Number(shiftNumber) }
        : (from && to ? { from, to } : null),
      summary: {
        totalTopups:      Math.round(totalTopups * 100) / 100,
        totalSpent:       Math.round(totalSpent  * 100) / 100,
        operationsCount:  operations.length,
        balance:          Math.round((card.balance || 0) * 100) / 100,
      },
      operations: pageOps,
      page: p,
      limit: l,
      totalOperations: operations.length,
    });
  } catch (err) {
    console.error(`❌ GET /api/cards/${req.params.card}/report:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Создание карты ──────────────────────────────────────────────────
router.post('/', auth, adminOnly, async (req, res) => {
  try {
    const { card, owner, phone, type, balance } = req.body || {};
    if (!card) return res.status(400).json({ error: 'card обязателен' });
    const normalized = String(card).trim().toUpperCase();
    const exists = await ClientCard.findOne({ card: normalized });
    if (exists) return res.status(409).json({ error: 'Карта уже существует' });
    const created = await ClientCard.create({
      card: normalized,
      owner: owner || '',
      phone: phone || '',
      type: type || 'standard',
      balance: Number(balance) || 0,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error('❌ POST /api/cards:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Обновление карты (без баланса!) ─────────────────────────────────
router.patch('/:card', auth, adminOnly, async (req, res) => {
  try {
    const normalized = String(req.params.card).toUpperCase();
    const allowed = ['owner', 'phone', 'type'];
    const update = {};
    for (const k of allowed) {
      if (typeof req.body?.[k] === 'string') update[k] = req.body[k];
    }
    const updated = await ClientCard.findOneAndUpdate({ card: normalized }, update, { new: true });
    if (!updated) return res.status(404).json({ error: 'Карта не найдена' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Удаление карты ──────────────────────────────────────────────────
router.delete('/:card', auth, adminOnly, async (req, res) => {
  try {
    const normalized = String(req.params.card).toUpperCase();
    const deleted = await ClientCard.findOneAndDelete({ card: normalized });
    if (!deleted) return res.status(404).json({ error: 'Карта не найдена' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Пополнение карты ────────────────────────────────────────────────
router.post('/:card/topup', auth, async (req, res) => {
  const cardNumber    = String(req.params.card || '').trim().toUpperCase();
  const amount        = Number(req.body?.amount);
  const paymentMethod = req.body?.paymentMethod || 'cash';

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
  }
  if (!['cash', 'card_terminal'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Для пополнения карты допустимы cash | card_terminal' });
  }

  try {
    const card = await ClientCard.findOne({ card: cardNumber });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });

    const newBalance = Math.round((card.balance + amount) * 100) / 100;

    const receipt = await req.app.locals.createReceipt({
      postId: 0,
      kind: 'advance_card',
      operation: 'topup',
      isAdvance: true,
      cardNumber,
      items: [{ name: `Пополнение карты ${cardNumber}`, seconds: 0, cost: amount, pricePerSecond: 0 }],
      totalCost: amount,
      balanceAfter: newBalance,
      paymentMethod,
    });

    card.balance = newBalance;
    await card.save();

    if (req.app.locals.publishCardBalanceToPosts) {
      await req.app.locals.publishCardBalanceToPosts(card.card);
    }

    res.json({
      ok: true, card: card.card, amount, balance: newBalance,
      paymentMethod, receiptNumber: receipt.receiptNumber,
      shiftNumber: receipt.shiftNumber,
      kind: 'advance_card', isAdvance: true,
    });
  } catch (err) {
    console.error('❌ card topup:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Прямая корректировка баланса ────────────────────────────────────
router.post('/:card/adjust', auth, adminOnly, async (req, res) => {
  const cardNumber = String(req.params.card || '').trim().toUpperCase();
  const amount     = Number(req.body?.amount);
  const reason     = String(req.body?.reason || 'Корректировка баланса');

  if (!amount || isNaN(amount)) {
    return res.status(400).json({ error: 'amount обязателен и должен быть числом' });
  }
  try {
    const card = await ClientCard.findOne({ card: cardNumber });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });

    const newBalance = Math.round((card.balance + amount) * 100) / 100;
    if (newBalance < 0) {
      return res.status(409).json({ error: `Баланс станет отрицательным (${newBalance})` });
    }

    const isInflow = amount > 0;
    const receipt = await req.app.locals.createReceipt({
      postId: 0,
      kind: isInflow ? 'advance_card' : 'refund',
      operation: isInflow ? 'topup' : 'refund',
      isAdvance: isInflow,
      cardNumber,
      items: [{ name: reason, seconds: 0, cost: Math.abs(amount), pricePerSecond: 0 }],
      totalCost: Math.abs(amount),
      balanceAfter: newBalance,
      paymentMethod: 'adjustment',
    });

    card.balance = newBalance;
    await card.save();

    if (req.app.locals.publishCardBalanceToPosts) {
      await req.app.locals.publishCardBalanceToPosts(card.card);
    }

    res.json({
      ok: true, card: card.card, amount, balance: newBalance,
      receiptNumber: receipt.receiptNumber, shiftNumber: receipt.shiftNumber,
      kind: receipt.kind,
    });
  } catch (err) {
    console.error('❌ card adjust:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;