// backend/routes/posts.js
// Эндпоинты для операций над балансом поста.
// Подключается в server.js: app.use('/api/posts', require('./routes/posts'));
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const ClientCard = require('../models/ClientCard');

// ── Auth middleware (как в cards.js) ─────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization?.split(' ')[1];
  const query  = typeof req.query.token === 'string' ? req.query.token : null;
  const token  = header || query;
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'secretkey'); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ── Поиск модели состояния постов ───────────────────────────────
// Пытаемся найти модель в нескольких местах, чтобы код был
// устойчив к тому, как именно вы храните баланс постов.
function resolvePostState(req) {
  if (req.app.locals.PostState)        return { kind: 'model', model: req.app.locals.PostState };
  if (req.app.locals.Post)             return { kind: 'model', model: req.app.locals.Post };
  try { return { kind: 'model', model: mongoose.model('PostState') }; } catch { /* */ }
  try { return { kind: 'model', model: mongoose.model('Post') }; }      catch { /* */ }
  if (req.app.locals.postStateService) return { kind: 'service', svc: req.app.locals.postStateService };
  return null;
}

// ── Чтение текущего баланса поста ───────────────────────────────
async function readPostBalance(postId, holder) {
  if (holder.kind === 'service') {
    const v = await holder.svc.getBalance(postId);
    return Number(v) || 0;
  }
  const Model = holder.model;
  // ищем либо по ObjectId, либо по полю postId
  let doc = null;
  if (mongoose.Types.ObjectId.isValid(String(postId))) {
    doc = await Model.findById(postId);
  }
  if (!doc) doc = await Model.findOne({ postId });
  if (!doc) throw Object.assign(new Error('Пост не найден'), { status: 404 });
  return { doc, balance: Number(doc.balance) || 0 };
}

// ── Запись нового баланса поста ─────────────────────────────────
async function writePostBalance(holder, doc, newBalance) {
  if (holder.kind === 'service') {
    await holder.svc.setBalance(doc, newBalance);
    return;
  }
  doc.balance = newBalance;
  await doc.save();
}

// ────────────────────────────────────────────────────────────────
// POST /api/posts/:postId/transfer-to-card
// Body: { card: string, amount: number }
// Атомарно переводит amount с баланса поста на баланс карты.
// ────────────────────────────────────────────────────────────────
router.post('/:postId/transfer-to-card', auth, async (req, res) => {
  const postId     = Number(req.params.postId);
  const cardNumber = String(req.body?.card || '').trim().toUpperCase();
  const amount     = Number(req.body?.amount);

  if (!cardNumber || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Некорректные card или amount' });
  }

  try {
    // 1. Карта
    const card = await ClientCard.findOne({ card: cardNumber });
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });

    // 2. Состояние поста
    const holder = resolvePostState(req);
    if (!holder) {
      return res.status(500).json({
        error:
          'Модель состояния постов не найдена. Зарегистрируйте её в app.locals.PostState ' +
          '(или app.locals.Post, или app.locals.postStateService).',
      });
    }

    const readResult = await readPostBalance(postId, holder);
    const currentPostBalance =
      typeof readResult === 'object' && readResult !== null && 'balance' in readResult
        ? readResult.balance
        : Number(readResult) || 0;
    const postDoc =
      typeof readResult === 'object' && readResult !== null && 'doc' in readResult
        ? readResult.doc
        : postId;

    if (currentPostBalance < amount) {
      return res.status(400).json({
        error: `Недостаточно средств на посте: ${currentPostBalance} < ${amount}`,
      });
    }

    // 3. Проверка хелперов из app.locals
    if (typeof req.app.locals.createReceipt !== 'function') {
      return res.status(500).json({ error: 'createReceipt не сконфигурирован' });
    }

    // 4. Расчёт новых балансов (с округлением до копеек)
    const newPostBalance = Math.round((currentPostBalance - amount) * 100) / 100;
    const newCardBalance = Math.round((Number(card.balance) + amount) * 100) / 100;

    // 5. Списываем с поста
    await writePostBalance(holder, postDoc, newPostBalance);

    // 6. Начисляем на карту
    card.balance = newCardBalance;
    await card.save();

    // 7. Создаём чек «Аванс: с поста» (kind=advance_card, paymentMethod=transfer_from_post)
    const receipt = await req.app.locals.createReceipt({
      postId,
      kind: 'advance_card',
      operation: 'topup',
      isAdvance: true,
      cardNumber,
      items: [{
        name: `Перевод с поста ${postId} на карту`,
        seconds: 0,
        cost: amount,
        pricePerSecond: 0,
      }],
      totalCost: amount,
      balanceAfter: newCardBalance,
      paymentMethod: 'transfer_from_post',
    });

    // 8. Публикация нового баланса карты во все посты (MQTT posts/N/clientcardbalance)
    if (typeof req.app.locals.publishCardBalanceToPosts === 'function') {
      try { await req.app.locals.publishCardBalanceToPosts(card.card); }
      catch (e) { console.warn('[transfer-to-card] publishCardBalanceToPosts:', e.message); }
    }

    // 9. Публикация нового баланса поста (если хелпер есть)
    if (typeof req.app.locals.publishPostState === 'function') {
      try { await req.app.locals.publishPostState(postId); }
      catch (e) { console.warn('[transfer-to-card] publishPostState:', e.message); }
    }

    res.json({
      success: true,
      card: card.card,
      amount,
      postBalance: newPostBalance,
      cardBalance: newCardBalance,
      receiptNumber: receipt.receiptNumber,
      shiftNumber: receipt.shiftNumber,
    });
  } catch (err) {
    console.error(`❌ POST /api/posts/${req.params.postId}/transfer-to-card:`, err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;