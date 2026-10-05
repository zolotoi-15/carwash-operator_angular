// src/app/services/client-card.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  ClientCard,
  ClientCardType,
  CardOperation,
  CardReportSummary,
} from '../models/client-card.model';

export interface CardReportResponse {
  summary: CardReportSummary;
  operations: CardOperation[];
}

@Injectable({ providedIn: 'root' })
export class ClientCardService {
  private readonly apiUrl = '/api/cards';

  constructor(private http: HttpClient) {}

  // ==== Чтение ====


  /** Получить все карты */
  getCards(): Observable<ClientCard[]> {
    return this.http.get<ClientCard[]>(this.apiUrl);
  }

  /**
   * Поиск карт по номеру, ФИО или телефону.
   * Бэкенд: GET /api/cards/search?q=...
   */
  searchCards(query: string): Observable<ClientCard[]> {
    const params = new HttpParams().set('q', query);
    return this.http.get<ClientCard[]>(`${this.apiUrl}/search`, { params });
  }

  /** Получить карту по номеру */
  getCard(card: string): Observable<ClientCard> {
    return this.http.get<ClientCard>(`${this.apiUrl}/${encodeURIComponent(card)}`);
  }

  // ==== Создание и обновление ====

  /** Создать карту */
  addCard(card: string, type: ClientCardType): Observable<ClientCard> {
    return this.http.post<ClientCard>(this.apiUrl, { card, type });
  }

  /**
   * Обновить ФИО и/или телефон.
   * Бэкенд: PATCH /api/cards/:card
   */
  updateCardInfo(
    card: string,
    data: { fullName?: string; phone?: string },
  ): Observable<ClientCard> {
    return this.http.patch<ClientCard>(
      `${this.apiUrl}/${encodeURIComponent(card)}`,
      data,
    );
  }

  // ==== Операции с балансом ====

  /**
   * Ручное пополнение карты оператором.
   * Бэкенд: POST /api/cards/:card/topup
   */
  topUp(card: string, amount: number): Observable<ClientCard> {
    return this.http.post<ClientCard>(
      `${this.apiUrl}/${encodeURIComponent(card)}/topup`,
      { amount },
    );
  }

  /**
   * Пополнение карты с баланса поста (терминала).
   * Вызывается из MqttService при сканировании карты,
   * если на поста накоплен положительный баланс.
   * Бэкенд: POST /api/cards/:card/topup-from-post
   */
  topUpFromPost(
    card: string,
    postId: string,
    amount: number,
  ): Observable<ClientCard> {
    return this.http.post<ClientCard>(
      `${this.apiUrl}/${encodeURIComponent(card)}/topup-from-post`,
      { postId, amount },
    );
  }

  // ==== Удаление ====

  /** Удалить карту */
  deleteCard(card: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/${encodeURIComponent(card)}`,
    );
  }

  // ==== Отчётность ====

  /**
   * Детальная отчётность по карте.
   * Бэкенд: GET /api/cards/:card/report?from=...&to=...
   */
  getCardReport(
    card: string,
    from?: string,
    to?: string,
  ): Observable<CardReportResponse> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);

    return this.http.get<CardReportResponse>(
      `${this.apiUrl}/${encodeURIComponent(card)}/report`,
      { params },
    );
  }
}