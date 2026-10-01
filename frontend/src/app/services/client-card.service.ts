import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ClientCard, ClientCardType } from '../models/client-card.model';

@Injectable({ providedIn: 'root' })
export class ClientCardService {
  private readonly apiUrl = '/api/cards';

  constructor(private http: HttpClient) { }

  getCards(): Observable<ClientCard[]> {
    return this.http.get<ClientCard[]>(this.apiUrl);
  }

  getCard(card: string): Observable<ClientCard> {
    return this.http.get<ClientCard>(`${this.apiUrl}/${card}`);
  }

  addCard(card: string, type: ClientCardType): Observable<ClientCard> {
    return this.http.post<ClientCard>(this.apiUrl, { card, type });
  }

  deleteCard(card: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/${card}`);
  }

  topUp(card: string, amount: number): Observable<ClientCard> {
    return this.http.post<ClientCard>(`${this.apiUrl}/${card}/topup`, { amount });
  }
}
