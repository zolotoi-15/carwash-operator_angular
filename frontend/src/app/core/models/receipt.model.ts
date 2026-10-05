export interface ReceiptServiceLine {
  name: string;
  pricePerSecond: number;   // цена за секунду
  seconds: number;
  total: number;
}

export interface ReceiptData {
  id: number;
  receiptNumber: number;
  postId: number;
  date: string;                // ISO string
  total: number;
  services: ReceiptServiceLine[];
  fiscal?: boolean;
}

export interface ReceiptFilter {
  from?: string;
  to?: string;
  postId?: number;
}