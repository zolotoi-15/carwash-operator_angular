// src/app/core/services/client-card.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ClientCard,
  ClientCardType,
  CardReportResponse,
} from '../models/client-card.model';

@Injectable({ providedIn: 'root' })
export class ClientCardService {
  private readonly apiUrl = '/api/cards';

  constructor(private http: HttpClient) {}

  // ==== Чтение ====

  /** Получить все карты */
  getCards(): Observable<ClientCard[]> {
    return this.http.get<ClientCard[]>(this.apiUrl);
  }

  /** Поиск карт по номеру, ФИО или телефону: GET /api/cards/search?q=... */
  searchCards(query: string): Observable<ClientCard[]> {
    const params = new HttpParams().set('q', query);
    return this.http.get<ClientCard[]>(`${this.apiUrl}/search`, { params });
  }

  /** Получить карту по номеру */
  getCard(card: string): Observable<ClientCard> {
    return this.http.get<ClientCard>(
      `${this.apiUrl}/${encodeURIComponent(card)}`,
    );
  }

  // ==== Создание и обновление ====

  /** Старый метод (для cards-management) — только card + type */
  addCard(card: string, type: ClientCardType): Observable<ClientCard> {
    return this.http.post<ClientCard>(this.apiUrl, { card, type });
  }

  /** Новый метод — сразу с ФИО и телефоном (для card-list) */
  createCard(dto: {
    card: string;
    type: ClientCardType;
    fullName?: string;
    phone?: string;
  }): Observable<ClientCard> {
    return this.http.post<ClientCard>(this.apiUrl, dto);
  }

  /** Обновить ФИО / телефон: PATCH /api/cards/:card */
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

  /** Ручное пополнение оператором: POST /api/cards/:card/topup */
  topUp(card: string, amount: number): Observable<ClientCard> {
    return this.http.post<ClientCard>(
      `${this.apiUrl}/${encodeURIComponent(card)}/topup`,
      { amount },
    );
  }

  /**
   * Перенос баланса с терминала поста на карту.
   * Вызывается из MqttService.handleCardScan при сканировании карты,
   * если на посту накоплен положительный баланс.
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

  /** Удалить карту: DELETE /api/cards/:card */
  deleteCard(card: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/${encodeURIComponent(card)}`,
    );
  }

  // ==== Отчётность ====

  /** Детальный отчёт по карте: GET /api/cards/:card/report?from=...&to=... */
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