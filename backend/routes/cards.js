// backend/routes/cards.js
const express = require('express');
const router = express.Router();
const ClientCard = require('../models/ClientCard');

// GET /api/cards/:card — одна карта
router.get('/:card', async (req, res) => {
  try {
    const card = await ClientCard.findOne({ card: req.params.card.toUpperCase() });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cards — список всех карт
router.get('/', async (req, res) => {
  try {
    const cards = await ClientCard.find().sort({ createdAt: -1 });
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// POST /api/cards — добавить карту
router.post('/', async (req, res) => {
  const { card, type } = req.body;
  if (!card || !type) {
    return res.status(400).json({ error: 'Поля card и type обязательны' });
  }
  if (!['client', 'operator', 'service'].includes(type)) {
    return res.status(400).json({ error: 'Недопустимый тип карты' });
  }
  try {
    const newCard = await ClientCard.create({
      card: card.toUpperCase(),
      type,
      balance: 0
    });
    res.status(201).json(newCard);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Карта уже существует' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cards/:card — удалить карту
router.delete('/:card', async (req, res) => {
  try {
    const deleted = await ClientCard.findOneAndDelete({
      card: req.params.card.toUpperCase()
    });
    if (!deleted) return res.status(404).json({ error: 'Карта не найдена' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
//**** */

// POST /api/cards/:card/topup — пополнить баланс
router.post('/:card/topup', async (req, res) => {
  const { amount } = req.body;

  const num = Number(amount);
  if (!num || num <= 0) {
    return res.status(400).json({ error: 'Сумма должна быть положительным числом' });
  }
  try {
    const card = await ClientCard.findOneAndUpdate(
      { card: req.params.card.toUpperCase() },
      { $inc: { balance: num } },
      { new: true }
    );
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });


    // === NEW: оповестить посты, где активна эта карта, о новом балансе ===
    if (req.app.locals.publishCardBalanceToPosts) {
      req.app.locals.publishCardBalanceToPosts(card.card).catch(() => { });
    }

    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
