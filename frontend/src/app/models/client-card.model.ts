// src/app/models/client-card.model.ts

export type ClientCardType = 'client' | 'operator' | 'service';

export interface ClientCard {
  _id?: string;
  card: string;              // номер карты (например, "8C8ADC80")
  type: ClientCardType;
  balance: number;
  fullName?: string;         // ФИО (необязательно)
  phone?: string;            // Телефон (необязательно)
  createdAt?: string;
  updatedAt?: string;
}

/** Параметры поиска карт */
export interface ClientCardSearchParams {
  query?: string;            // универсальный поиск: номер карты | ФИО | телефон
}

/** Одна операция по карте (для детальной отчётности) */
export interface CardOperation {
  _id?: string;
  card: string;
  type: 'topup' | 'charge' | 'topup_from_post' | 'refund';
  amount: number;
  balanceAfter: number;
  date: string;              // ISO-строка
  postId?: string;
  receiptNumber?: string;
  operatorName?: string;
  comment?: string;
}

/** Сводка по карте (для детальной отчётности) */
export interface CardReportSummary {
  balance: number;
  totalTopUps: number;
  totalCharges: number;
  operationsCount: number;
}