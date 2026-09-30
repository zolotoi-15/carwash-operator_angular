export interface ReceiptItem {
  name: string;
  price: number;
  quantity: number;
  department?: number;
  tax?: number;
}

export interface ReceiptData {
  postId: string;
  items: ReceiptItem[];
  totalCash?: number;
  cashierName?: string;
  receiptNumber?: number;
  operation?: string;
  timestamp?: Date;
  balance?: number;   // <-- добавить
}
