export interface ReceiptServiceLine {
  name: string;
  pricePerSecond: number;
  seconds: number;
  total: number;
}

export interface ReceiptData {
  id: number;
  receiptNumber: number;
  postId: number;
  date: string;
  total: number;
  services: ReceiptServiceLine[];
  fiscal?: boolean;
}

export interface ReceiptFilter {
  from?: string;
  to?: string;
  postId?: number;
}

export interface ReceiptItem {
  name: string;
  cost: number;
  pricePerSecond: number;
  seconds: number;
}