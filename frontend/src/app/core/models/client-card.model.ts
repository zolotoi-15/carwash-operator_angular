// frontend/src/app/core/models/client-card.model.ts

/**
 * Карта клиента / оператора / сервисная.
 *
 * ВАЖНО: id — строка (Mongo ObjectId приходит с бэкенда как строка).
 * Раньше было number — это вызывало ошибки типов при сравнении.
 */
export interface ClientCard {
  id: string;
  number: string;               // на бэке — поле 'card', но toDto переименовывает в 'number'
  name?: string;
  phone?: string;
  type: 'client' | 'operator' | 'service';
  balance: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * DTO для создания карты.
 * Использует 'number', а не 'card' — так шлёт фронт,
 * а бэкенд принимает оба варианта (см. routes/cards.js).
 */
export interface CreateClientCardDto {
  number: string;
  name?: string;
  phone?: string;
  type?: 'client' | 'operator' | 'service';
}

/**
 * DTO для пополнения баланса.
 */
export interface TopUpDto {
  amount: number;
  comment?: string;
}

/**
 * Операция по карте (пополнение/списание/возврат).
 * Соответствует тому, что возвращает GET /api/cards/:card/operations
 */
export interface CardOperation {
  id: string;
  cardId: string;               // на бэке — card (номер карты) или cardId
  type: 'topup' | 'charge' | 'refund';
  amount: number;
  date: string;                 // ISO
  description?: string;
}