import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

// ✅ Используем существующие модели — не дублируем типы
import {
  ClientCard,
  CardOperation,
} from '../models/client-card.model';

export interface TopUpPayload {
  amount: number;
  comment?: string;
}

@Injectable({ providedIn: 'root' })
export class ClientCardService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/cards`;

  private cardsSubject = new BehaviorSubject<ClientCard[]>([]);

  // ============================================================
  // Список / поиск
  // ============================================================
  getCards(): Observable<ClientCard[]> {
    return this.http.get<ClientCard[]>(this.apiUrl)
      .pipe(tap(list => this.cardsSubject.next(list)));
  }

  searchCards(query: string): Observable<ClientCard[]> {
    return this.http.get<ClientCard[]>(this.apiUrl, {
      params: { q: query || '' }
    });
  }

  getAll(): Observable<ClientCard[]> {
    return this.getCards();
  }

  getByNumber(cardNumber: string): Observable<ClientCard> {
    return this.http.get<ClientCard>(`${this.apiUrl}/by-number/${encodeURIComponent(cardNumber)}`);
  }

  getById(id: number | string): Observable<ClientCard> {
    return this.http.get<ClientCard>(`${this.apiUrl}/${id}`);
  }

  // ============================================================
  // CRUD — принимают Partial<ClientCard> (в т.ч. { number, name, ... })
  // ============================================================
  createCard(data: Partial<ClientCard>): Observable<ClientCard> {
    return this.http.post<ClientCard>(this.apiUrl, data);
  }

  create(data: Partial<ClientCard>): Observable<ClientCard> {
    return this.createCard(data);
  }

  update(id: number | string, data: Partial<ClientCard>): Observable<ClientCard> {
    return this.http.put<ClientCard>(`${this.apiUrl}/${id}`, data);
  }

  deleteCard(id: number | string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }

  remove(id: number | string): Observable<any> {
    return this.deleteCard(id);
  }

  // ============================================================
  // Баланс / операции — id это Mongo _id (number из модели)
  // ============================================================
  topUp(id: number | string, payload: TopUpPayload): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${id}/topup`, payload);
  }

  /** По номеру карты — используется в mqtt.service.ts */
  topUpByNumber(cardNumber: string, payload: TopUpPayload): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/by-number/${encodeURIComponent(cardNumber)}/topup`,
      payload
    );
  }

  debit(id: number | string, payload: { amount: number; postId?: number; comment?: string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${id}/debit`, payload);
  }

  getOperations(id: number | string, limit = 100): Observable<CardOperation[]> {
    return this.http.get<CardOperation[]>(
      `${this.apiUrl}/${id}/operations`,
      { params: { limit: String(limit) } }
    );
  }

  /** Алиас, используется в card-list.component.ts */
  getCardOperations(id: number | string, limit = 100): Observable<CardOperation[]> {
    return this.getOperations(id, limit);
  }

  // ============================================================
  // Освобождение карты
  // ============================================================
  releaseCard(cardNumber: string): Observable<{ ok: boolean; released: boolean }> {
    return this.http.post<{ ok: boolean; released: boolean }>(
      `${this.apiUrl}/by-number/${encodeURIComponent(cardNumber)}/release`,
      {}
    );
  }

  // ============================================================
  // Потоки
  // ============================================================
  getCardsUpdates(): Observable<ClientCard[]> {
    return this.cardsSubject.asObservable();
  }
}