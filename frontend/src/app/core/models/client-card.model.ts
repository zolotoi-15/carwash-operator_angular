export interface ClientCard {
  id: number;
  number: string;
  name?: string;
  phone?: string;
  type: 'client' | 'admin' | 'service';
  balance: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateClientCardDto {
  number: string;
  name?: string;
  phone?: string;
  type?: 'client' | 'admin' | 'service';
}

export interface TopUpDto {
  amount: number;
}

export interface CardOperation {
  id: number;
  cardId: number;
  type: 'topup' | 'charge' | 'refund';
  amount: number;
  date: string;
  description?: string;
}