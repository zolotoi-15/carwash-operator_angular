export type PaymentType = 'cash' | 'card' | 'client_card';

export interface ReceiptItem {
  serviceId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Receipt {
  _id?: string;
  number?: string;
  createdAt?: string;
  items: ReceiptItem[];
  total: number;
  paymentType: PaymentType;
  clientCardNumber?: string;   // заполняется только если paymentType === 'client_card'
  shiftId?: string;
  operatorId?: string;
  postId?: string;
}
