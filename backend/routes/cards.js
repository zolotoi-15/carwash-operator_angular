// backend/routes/cards.js
const express = require('express');
const router = express.Router();
const ClientCard = require('../models/ClientCard');

// ============================================================
// Вспомогательное: превращает Mongoose-документ в DTO,
// который ждёт фронт ({ id, number, name, phone, type, balance })
// ============================================================
function toDto(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject({ virtuals: true }) : doc;
  return {
    id: String(obj._id || obj.id || ''),
    number: obj.card || obj.number || '',
    name: obj.name || '',
    phone: obj.phone || '',
    type: obj.type || 'client',
    balance: Number(obj.balance) || 0,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

// GET /api/cards/:card — одна карта по номеру
router.get('/:card', async (req, res) => {
  try {
    const card = await ClientCard.findOne({
      card: String(req.params.card).toUpperCase(),
    });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    res.json(toDto(card));
  } catch (err) {
    console.error('[GET /api/cards/:card]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cards — список всех карт (+ простой поиск по query)
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = q
      ? {
          $or: [
            { card:  { $regex: q, $options: 'i' } },
            { name:  { $regex: q, $options: 'i' } },
            { phone: { $regex: q, $options: 'i' } },
          ],
        }
      : {};

    const cards = await ClientCard.find(filter).sort({ createdAt: -1 });
    res.json(cards.map(toDto));
  } catch (err) {
    console.error('[GET /api/cards]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cards — добавить карту
// Принимает и { number }, и { card } — фронт шлёт number
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const cardNumber = String(body.number || body.card || '').trim().toUpperCase();
    const type = body.type || 'client';
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();

    if (!cardNumber) {
      return res.status(400).json({ error: 'Поле "number" обязательно' });
    }
    if (!['client', 'operator', 'service'].includes(type)) {
      return res.status(400).json({ error: 'Недопустимый тип карты' });
    }
    if (!/^[0-9A-F]+$/i.test(cardNumber)) {
      return res.status(400).json({ error: 'Номер карты должен содержать только 0-9 и A-F' });
    }

    const newCard = await ClientCard.create({
      card: cardNumber,
      name,
      phone,
      type,
      balance: 0,
    });

    res.status(201).json(toDto(newCard));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Карта уже существует' });
    }
    console.error('[POST /api/cards] error:', err);
    res.status(400).json({ error: err.message, details: err.errors });
  }
});

// DELETE /api/cards/:card — удалить по номеру карты
router.delete('/:card', async (req, res) => {
  try {
    const deleted = await ClientCard.findOneAndDelete({
      card: String(req.params.card).toUpperCase(),
    });
    if (!deleted) return res.status(404).json({ error: 'Карта не найдена' });
    res.json({ success: true, id: String(deleted._id) });
  } catch (err) {
    console.error('[DELETE /api/cards/:card]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cards/:card/topup — пополнить баланс
router.post('/:card/topup', async (req, res) => {
  const num = Number(req.body?.amount);
  if (!num || num <= 0) {
    return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
  }
  try {
    const card = await ClientCard.findOneAndUpdate(
      { card: String(req.params.card).toUpperCase() },
      { $inc: { balance: num } },
      { new: true }
    );
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });

    if (req.app.locals.publishCardBalanceToPosts) {
      req.app.locals.publishCardBalanceToPosts(card.card).catch(() => {});
    }
    res.json(toDto(card));
  } catch (err) {
    console.error('[POST /api/cards/:card/topup]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;