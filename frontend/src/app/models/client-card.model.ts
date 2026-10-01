// client-card.model.ts
export type ClientCardType = 'client' | 'operator' | 'service';

export interface ClientCard {
  _id?: string;
  card: string;
  balance: number;
  type: ClientCardType;
  fullName?: string;   // ФИО (необязательно)
  phone?: string;      // Телефон (необязательно)
  createdAt?: string;
  updatedAt?: string;
}

// Дополнительно — для фильтрации/поиска
export interface ClientCardSearchParams {
  query?: string;      // универсальный поиск (номер карты, ФИО, телефон)
}
