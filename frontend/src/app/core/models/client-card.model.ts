// src/app/core/models/client-card.model.ts
export type ClientCardType = 'client' | 'operator' | 'service';

export interface ClientCard {
  _id?: string;
  card: string;                 // "8C8ADC80"
  type: ClientCardType;
  balance: number;
  fullName?: string;
  phone?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateClientCardDto {
  card: string;
  type: ClientCardType;
  fullName?: string;
  phone?: string;
}

export interface CardOperation {
  _id?: string;
  card: string;
  type: 'topup' | 'charge' | 'topup_from_post' | 'refund' | 'adjustment';
  amount: number;
  balanceAfter: number;
  createdAt: string;
  postId?: string | null;
  receiptNumber?: string | null;
  operatorName?: string | null;
  comment?: string | null;
}

export interface CardReportSummary {
  balance: number;
  totalTopUps: number;
  totalCharges: number;
  operationsCount: number;
}

export interface CardReportResponse {
  summary: CardReportSummary;
  operations: CardOperation[];
}