router.put('/', async (req, res) => {
  try {
    console.log('[settings PUT] body:', JSON.stringify(req.body, null, 2));
    const doc = await Settings.findOneAndUpdate(
      { key: 'main' },
      { $set: req.body },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json(doc);
  } catch (e) {
    console.error('[settings PUT] error:', e);
    res.status(400).json({ error: e.message, details: e.errors });
  }
});