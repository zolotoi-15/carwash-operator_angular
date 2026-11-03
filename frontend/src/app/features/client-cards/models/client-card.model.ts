export interface ClientCard {
  id: string;              // было number
  number: string;
  name?: string;
  phone?: string;
  type: 'client' | 'admin' | 'service';
  balance: number;
  createdAt?: string;
  updatedAt?: string;
}