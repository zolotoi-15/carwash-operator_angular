export type ShiftStatus = 'open' | 'closed';

export interface CashShift {
  _id?: string;
  openedAt: string;              // ISO строка
  closedAt?: string;
  openedBy: string;              // id оператора
  closedBy?: string;             // id оператора или 'system'
  status: ShiftStatus;
  autoClosed?: boolean;          // true если закрыта автоматически
  openingBalance?: number;
  closingBalance?: number;
  totalCash?: number;
  totalCard?: number;
  totalClientCard?: number;
}
