// backend/routes/shifts.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

function getShiftModel()   { return mongoose.model('CashShift'); }
function getCounterModel() { return mongoose.model('Counter'); }

function mapShift(shift) {
  if (!shift) return null;
  return {
    _id:            shift._id,
    openedAt:       shift.openedAt,
    closedAt:       shift.closedAt,
    openedBy:       shift.openedBy || 'system',
    closedBy:       shift.closedBy || null,
    status:         shift.status || 'open',
    autoClosed:     !!shift.autoClosed,
    openingBalance: shift.openingBalance || 0,
    closingBalance: shift.closingBalance || 0,
    totalCash:      shift.totalCash || 0,
    totalCard:      shift.totalCard || 0,
    totalClientCard: shift.totalClientCard || 0,
  };
}

// GET /api/shifts/current
router.get('/current', async (_req, res) => {
  try {
    const Shift = getShiftModel();
    const shift = await Shift.findOne({ status: 'open' }).sort({ openedAt: -1 });
    res.json(mapShift(shift));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/open
router.post('/open', async (req, res) => {
  try {
    const Shift = getShiftModel();

    const existing = await Shift.findOne({ status: 'open' });
    if (existing) return res.status(409).json({ error: 'Смена уже открыта' });

    const shift = await Shift.create({
      openedAt:       new Date(),
      openedBy:       req.body.userId || 'system',
      status:         'open',
      openingBalance: Number(req.body.openingBalance) || 0,
    });

    res.status(201).json(mapShift(shift));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/close
router.post('/close', async (req, res) => {
  try {
    const Shift = getShiftModel();
    const { shiftId, userId, closingBalance, auto } = req.body;

    let shift;
    if (shiftId) shift = await Shift.findById(shiftId);
    else         shift = await Shift.findOne({ status: 'open' });

    if (!shift) return res.status(404).json({ error: 'Смена не найдена' });
    if (shift.status === 'closed') return res.json(mapShift(shift));

    shift.status         = 'closed';
    shift.closedAt       = new Date();
    shift.closedBy       = userId || 'system';
    shift.autoClosed     = !!auto;
    shift.closingBalance = Number(closingBalance) || 0;
    await shift.save();

    res.json(mapShift(shift));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;