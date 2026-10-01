// backend/routes/shifts.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

function getShiftModel()  { return mongoose.model('Shift'); }
function getCounterModel() { return mongoose.model('Counter'); }

function mapShift(shift) {
  if (!shift) return null;
  return {
    _id: shift._id,
    shiftNumber: shift.shiftNumber,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    openedBy: shift.cashier || 'system',
    closedBy: shift.closedBy || null,
    status: shift.shiftOpen ? 'open' : 'closed',
    autoClosed: !!shift.autoClosed,
    openingBalance: shift.openingBalance || 0,
    closingBalance: shift.closingBalance || 0,
  };
}

// GET /api/shifts/current
router.get('/current', async (_req, res) => {
  try {
    const Shift = getShiftModel();
    const shift = await Shift.findOne({ shiftOpen: true }).sort({ openedAt: -1 });
    res.json(mapShift(shift));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/open
router.post('/open', async (req, res) => {
  try {
    const Shift = getShiftModel();
    const Counter = getCounterModel();

    const existing = await Shift.findOne({ shiftOpen: true });
    if (existing) return res.status(409).json({ error: 'Смена уже открыта' });

    const counter = await Counter.findByIdAndUpdate(
      'shiftNumber',
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );

    const shift = await Shift.create({
      shiftNumber: counter.seq,
      shiftOpen: true,
      openedAt: new Date(),
      cashier: req.body.userId || 'system',
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
    else shift = await Shift.findOne({ shiftOpen: true });

    if (!shift) return res.status(404).json({ error: 'Смена не найдена' });
    if (!shift.shiftOpen) return res.json(mapShift(shift));

    shift.shiftOpen = false;
    shift.closedAt = new Date();
    shift.closedBy = userId || 'system';
    shift.autoClosed = !!auto;
    shift.closingBalance = Number(closingBalance) || 0;
    await shift.save();

    res.json(mapShift(shift));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;