import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ClientCard, ClientCardType, CardReportResponse,
} from '../models/client-card.model';

@Injectable({ providedIn: 'root' })
export class ClientCardService {
  private readonly apiUrl = '/api/cards';

  constructor(private http: HttpClient) {}

  getCards(): Observable<ClientCard[]> {
    return this.http.get<ClientCard[]>(this.apiUrl);
  }

  searchCards(query: string): Observable<ClientCard[]> {
    const params = new HttpParams().set('q', query);
    return this.http.get<ClientCard[]>(`${this.apiUrl}/search`, { params });
  }

  getCard(card: string): Observable<ClientCard> {
    return this.http.get<ClientCard>(`${this.apiUrl}/${encodeURIComponent(card)}`);
  }

  /** Старый метод (для cards-management). */
  addCard(card: string, type: ClientCardType): Observable<ClientCard> {
    return this.http.post<ClientCard>(this.apiUrl, { card, type });
  }

  /** Новый метод — сразу с ФИО/телефоном (для card-list). */
  createCard(dto: {
    card: string; type: ClientCardType; fullName?: string; phone?: string;
  }): Observable<ClientCard> {
    return this.http.post<ClientCard>(this.apiUrl, dto);
  }

  updateCardInfo(card: string, data: { fullName?: string; phone?: string }): Observable<ClientCard> {
    return this.http.patch<ClientCard>(`${this.apiUrl}/${encodeURIComponent(card)}`, data);
  }

  topUp(card: string, amount: number): Observable<ClientCard> {
    return this.http.post<ClientCard>(
      `${this.apiUrl}/${encodeURIComponent(card)}/topup`, { amount },
    );
  }

  topUpFromPost(card: string, postId: string, amount: number): Observable<ClientCard> {
    return this.http.post<ClientCard>(
      `${this.apiUrl}/${encodeURIComponent(card)}/topup-from-post`,
      { postId, amount },
    );
  }

  deleteCard(card: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${encodeURIComponent(card)}`);
  }

  getCardReport(card: string, from?: string, to?: string): Observable<CardReportResponse> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<CardReportResponse>(
      `${this.apiUrl}/${encodeURIComponent(card)}/report`, { params },
    );
  }
}