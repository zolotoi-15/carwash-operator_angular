export interface CashShift {
  id: number;
  openedAt: string;
  closedAt?: string;
  openedBy: string;
  closedBy?: string;
  totalCash: number;
  receiptCount: number;
  isOpen: boolean;
}