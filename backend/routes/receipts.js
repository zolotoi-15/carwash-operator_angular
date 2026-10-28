// backend/routes/receipts.js
const express = require('express');
const router = express.Router();
const Receipt = require('../models/Receipt');

// GET /api/receipts?from=ISO&to=ISO&postId=N&kind=topup_card&limit=1000
router.get('/', async (req, res) => {
  const filter = {};

  if (req.query.from || req.query.to) {
    filter.timestamp = {};
    if (req.query.from) filter.timestamp.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      filter.timestamp.$lte = to;
    }
  }
  if (req.query.postId) filter.postId = Number(req.query.postId);
  if (req.query.kind)   filter.kind   = String(req.query.kind);

  const limit = Math.min(Number(req.query.limit) || 5000, 10000);

  try {
    const list = await Receipt.find(filter).sort({ timestamp: -1 }).limit(limit).lean();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/receipts/summary?from=...&to=...
router.get('/summary', async (req, res) => {
  const match = {};
  if (req.query.from || req.query.to) {
    match.timestamp = {};
    if (req.query.from) match.timestamp.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      match.timestamp.$lte = to;
    }
  }

  try {
    const agg = await Receipt.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$totalCost' }, count: { $sum: 1 } } },
    ]);
    const { total = 0, count = 0 } = agg[0] || {};
    res.json({ total, count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/receipts — используется MQTT-обработчиком на бэкенде
router.post('/', async (req, res) => {
  try {
    const r = await Receipt.create(req.body);
    res.status(201).json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/receipts/:id
router.delete('/:id', async (req, res) => {
  try {
    const d = await Receipt.findByIdAndDelete(req.params.id);
    if (!d) return res.status(404).json({ error: 'Receipt not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;