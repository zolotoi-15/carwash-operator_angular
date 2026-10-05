export type ShiftStatus = 'open' | 'closed';

export interface CashShift {
  id: number;
  status: ShiftStatus;
  openedAt: string;
  closedAt?: string;
  openedBy: string;
  closedBy?: string;
  totalCash: number;
  receiptCount: number;
}