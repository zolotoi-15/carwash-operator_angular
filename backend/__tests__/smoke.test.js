const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('modules load', () => {
  test('routes/cards.js загружается', () => {
    expect(() => require('../routes/cards')).not.toThrow();
  });
  test('routes/shifts.js загружается', () => {
    expect(() => require('../routes/shifts')).not.toThrow();
  });
  test('models/CardOperation.js загружается', () => {
    expect(() => require('../models/CardOperation')).not.toThrow();
  });
  test('models/ClientCard.js загружается', () => {
    expect(() => require('../models/ClientCard')).not.toThrow();
  });
});

describe('cards API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/cards', require('../routes/cards'));
  });

  test('GET /api/cards возвращает пустой массив', async () => {
    const res = await request(app).get('/api/cards');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/cards создаёт карту', async () => {
    const res = await request(app)
      .post('/api/cards')
      .send({ card: 'ABCD1234', type: 'client' });
    expect(res.status).toBe(201);
    expect(res.body.card).toBe('ABCD1234');
  });

  test('POST /api/cards валидирует тип', async () => {
    const res = await request(app)
      .post('/api/cards')
      .send({ card: 'BADTYPE1', type: 'unknown' });
    expect(res.status).toBe(400);
  });
});