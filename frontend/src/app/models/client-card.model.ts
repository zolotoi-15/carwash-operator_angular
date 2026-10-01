export type ClientCardType = 'client' | 'operator' | 'service';

export interface ClientCard {
  _id?: string;
  card: string;
  balance: number;
  type: ClientCardType;
  createdAt?: string;
  updatedAt?: string;
}
