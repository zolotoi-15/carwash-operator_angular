// frontend/src/app/core/models/client-card.model.ts
export type ClientCardType = 'client' | 'operator' | 'service';

export interface ClientCard {
  /** Номер карты (hex, uppercase). Бэкендное поле `card`. */
  card: string;
  balance: number;
  type: ClientCardType;
  fullName?: string;
  phone?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * DTO для создания карты.
 * ★ `type` обязателен — этого требует client-card.service.ts (createCard).
 */
export interface CreateClientCardDto {
  card: string;
  type: ClientCardType;
  fullName?: string;
  phone?: string;
  balance?: number;
}

/**
 * ★ Операция по карте — «плоский» UI-формат для модалки отчёта.
 *
 * Содержит поля из двух источников:
 *   • legacy-модели CardOperation.js (createdAt, type, comment) — их использует шаблон;
 *   • нового ответа /api/cards/:card/report (timestamp, kind, description, ...) —
 *     они мапятся в legacy-поля в CardListComponent.openReport().
 */
export interface CardOperation {
  /** ★ legacy: дата операции (из API — timestamp). Используется в шаблоне. */
  createdAt: string;
  /** ★ legacy: тип операции ('topup' | 'topup_from_post' | 'charge' | 'refund'). */
  type: 'topup' | 'topup_from_post' | 'charge' | 'refund' | string;
  /** ★ legacy: комментарий/описание (из API — description). */
  comment: string;

  // ── Поля из ответа API /api/cards/:card/report ─────────────────
  receiptNumber: number;
  timestamp: string;
  shiftNumber: number | null;
  postId: number;
  kind: string;
  operation: string;
  isInflow: boolean;
  amount: number;
  displayAmount: number;
  balanceAfter: number;
  paymentMethod: string | null;
  description: string;
  items: { name: string; seconds: number; cost: number }[];
}

export interface CardReportSummary {
  totalTopups: number;
  totalSpent: number;
  operationsCount: number;
  balance: number;
}

export interface CardReportResponse {
  card: { card: string; owner?: string; phone?: string; type?: string; balance: number };
  filter: any;
  summary: CardReportSummary;
  operations: CardOperation[];
  page: number;
  limit: number;
  totalOperations: number;
}