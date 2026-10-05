import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ClientCard,
  CreateClientCardDto,
  TopUpDto,
  CardOperation
} from '../models/client-card.model';

@Injectable({ providedIn: 'root' })
export class ClientCardService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/cards`;

  // ===== MOCK =====
  private mockCards: ClientCard[] = [
    { id: 1, number: '0C451349', type: 'client', balance: 77.40 },
    { id: 2, number: '8C8ADC80', type: 'client', balance: 471.83 }
  ];

  private mockOperations: CardOperation[] = [];

  // ===== API =====

  getCards(): Observable<ClientCard[]> {
    return of(this.mockCards);
    // return this.http.get<ClientCard[]>(this.apiUrl);
  }

  searchCards(query: string): Observable<ClientCard[]> {
    const q = query.trim().toLowerCase();
    if (!q) return of(this.mockCards);
    return of(this.mockCards.filter(c =>
      c.number.toLowerCase().includes(q) ||
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').includes(q)
    ));
    // return this.http.get<ClientCard[]>(`${this.apiUrl}/search`, { params: { q } });
  }

  getCard(id: number): Observable<ClientCard> {
    const card = this.mockCards.find(c => c.id === id);
    return card ? of(card) : throwError(() => new Error('Карта не найдена'));
  }

  getCardByNumber(number: string): Observable<ClientCard> {
    const normalized = number.trim().toUpperCase();
    const card = this.mockCards.find(c => c.number.toUpperCase() === normalized);
    return card ? of(card) : throwError(() => new Error('Карта не найдена'));
  }

  createCard(dto: CreateClientCardDto): Observable<ClientCard> {
    const newCard: ClientCard = {
      id: this.mockCards.length + 1,
      number: dto.number.toUpperCase(),
      name: dto.name,
      phone: dto.phone,
      type: dto.type ?? 'client',
      balance: 0,
      createdAt: new Date().toISOString()
    };
    this.mockCards.push(newCard);
    return of(newCard);
    // return this.http.post<ClientCard>(this.apiUrl, dto);
  }

  topUp(id: number, dto: TopUpDto): Observable<ClientCard> {
    const card = this.mockCards.find(c => c.id === id);
    if (!card) return throwError(() => new Error('Карта не найдена'));
    card.balance += dto.amount;
    card.updatedAt = new Date().toISOString();
    this.mockOperations.push({
      id: this.mockOperations.length + 1,
      cardId: id,
      type: 'topup',
      amount: dto.amount,
      date: new Date().toISOString(),
      description: 'Пополнение'
    });
    return of(card);
    // return this.http.post<ClientCard>(`${this.apiUrl}/${id}/topup`, dto);
  }

  /** Пополнение по номеру карты (используется, когда карту считали с поста) */
  topUpByNumber(number: string, dto: TopUpDto): Observable<ClientCard> {
    const normalized = number.trim().toUpperCase();
    const card = this.mockCards.find(c => c.number.toUpperCase() === normalized);
    if (!card) return throwError(() => new Error('Карта не найдена'));
    return this.topUp(card.id, dto);
  }

  deleteCard(id: number): Observable<void> {
    this.mockCards = this.mockCards.filter(c => c.id !== id);
    return of(void 0);
    // return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getCardOperations(cardId: number): Observable<CardOperation[]> {
    return of(this.mockOperations.filter(op => op.cardId === cardId));
    // return this.http.get<CardOperation[]>(`${this.apiUrl}/${cardId}/operations`);
  }
}