import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
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

  // ===== STATE =====
  private cardsSubject = new BehaviorSubject<ClientCard[]>([]);
  readonly cards$ = this.cardsSubject.asObservable();

  // ===== MOCK-данные (удалить после подключения API) =====
  private mockCards: ClientCard[] = [
    { id: 1, number: '0C451349', type: 'client', balance: 77.40 },
    { id: 2, number: '8C8ADC80', type: 'client', balance: 471.83 }
  ];

  private mockOperations: CardOperation[] = [];

  constructor() {
    // Инициализируем кэш при первом создании сервиса
    this.cardsSubject.next([...this.mockCards]);
  }

  // ===== ЧТЕНИЕ =====

  getCards(): Observable<ClientCard[]> {
    // MOCK: сразу отдаём локальный кэш
    this.cardsSubject.next([...this.mockCards]);
    return of(this.mockCards);

    // REAL:
    // return this.http.get<ClientCard[]>(this.apiUrl).pipe(
    //   tap(cards => this.cardsSubject.next(cards))
    // );
  }

  getCard(id: number): Observable<ClientCard> {
    const found = this.mockCards.find(c => c.id === id);
    if (!found) {
      throw new Error(`Карта с id=${id} не найдена`);
    }
    return of(found);
    // REAL: return this.http.get<ClientCard>(`${this.apiUrl}/${id}`);
  }

  getCardByNumber(number: string): Observable<ClientCard | null> {
    const normalized = String(number || '').trim().toUpperCase();
    const found = this.mockCards.find(
      c => c.number.toUpperCase() === normalized
    );
    return of(found ?? null);
    // REAL: return this.http.get<ClientCard>(`${this.apiUrl}/by-number/${normalized}`);
  }

  searchCards(query: string): Observable<ClientCard[]> {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return of([...this.mockCards]);

    const filtered = this.mockCards.filter(c =>
      c.number.toLowerCase().includes(q) ||
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').includes(q)
    );
    return of(filtered);
    // REAL: return this.http.get<ClientCard[]>(`${this.apiUrl}/search`, { params: { q } });
  }

  // ===== СОЗДАНИЕ =====

  createCard(dto: CreateClientCardDto): Observable<ClientCard> {
    const newCard: ClientCard = {
      id: Math.max(0, ...this.mockCards.map(c => c.id)) + 1,
      number: dto.number.trim().toUpperCase(),
      name: dto.name?.trim() || undefined,
      phone: dto.phone?.trim() || undefined,
      type: dto.type ?? 'client',
      balance: 0,
      createdAt: new Date().toISOString()
    };

    this.mockCards.push(newCard);
    this.cardsSubject.next([...this.mockCards]);
    return of(newCard);

    // REAL:
    // return this.http.post<ClientCard>(this.apiUrl, dto).pipe(
    //   tap(card => this.cardsSubject.next([...this.mockCards, card]))
    // );
  }

  // ===== ОБНОВЛЕНИЕ =====

  updateCard(id: number, dto: Partial<CreateClientCardDto>): Observable<ClientCard> {
    const idx = this.mockCards.findIndex(c => c.id === id);
    if (idx < 0) throw new Error(`Карта с id=${id} не найдена`);

    this.mockCards[idx] = {
      ...this.mockCards[idx],
      ...dto,
      number: dto.number ? dto.number.trim().toUpperCase() : this.mockCards[idx].number
    };
    this.cardsSubject.next([...this.mockCards]);
    return of(this.mockCards[idx]);

    // REAL: return this.http.put<ClientCard>(`${this.apiUrl}/${id}`, dto);
  }

  // ===== ПОПОЛНЕНИЕ =====

  topUp(id: number, dto: TopUpDto): Observable<ClientCard> {
    const idx = this.mockCards.findIndex(c => c.id === id);
    if (idx < 0) throw new Error(`Карта с id=${id} не найдена`);

    const amount = Math.round(Number(dto.amount) * 100) / 100;
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Сумма пополнения должна быть положительной');
    }

    this.mockCards[idx] = {
      ...this.mockCards[idx],
      balance: Math.round((this.mockCards[idx].balance + amount) * 100) / 100
    };

    // Записываем операцию
    this.mockOperations.push({
      id: this.mockOperations.length + 1,
      cardId: id,
      type: 'topup',
      amount,
      date: new Date().toISOString()
    });

    this.cardsSubject.next([...this.mockCards]);
    return of(this.mockCards[idx]);

    // REAL:
    // return this.http.post<ClientCard>(`${this.apiUrl}/${id}/topup`, dto).pipe(
    //   tap(card => {
    //     const updated = this.mockCards.map(c => c.id === id ? card : c);
    //     this.cardsSubject.next(updated);
    //   })
    // );
  }

  // ===== СПИСАНИЕ (используется при оплате с карты) =====

  charge(id: number, amount: number, description?: string): Observable<ClientCard> {
    const idx = this.mockCards.findIndex(c => c.id === id);
    if (idx < 0) throw new Error(`Карта с id=${id} не найдена`);

    const sum = Math.round(Number(amount) * 100) / 100;
    if (isNaN(sum) || sum <= 0) throw new Error('Сумма списания должна быть положительной');

    if (this.mockCards[idx].balance < sum) {
      throw new Error('Недостаточно средств на карте');
    }

    this.mockCards[idx] = {
      ...this.mockCards[idx],
      balance: Math.round((this.mockCards[idx].balance - sum) * 100) / 100
    };

    this.mockOperations.push({
      id: this.mockOperations.length + 1,
      cardId: id,
      type: 'charge',
      amount: sum,
      date: new Date().toISOString(),
      description
    });

    this.cardsSubject.next([...this.mockCards]);
    return of(this.mockCards[idx]);

    // REAL: return this.http.post<ClientCard>(`${this.apiUrl}/${id}/charge`, { amount, description });
  }

  // ===== УДАЛЕНИЕ =====

  deleteCard(id: number): Observable<void> {
    this.mockCards = this.mockCards.filter(c => c.id !== id);
    this.cardsSubject.next([...this.mockCards]);
    return of(void 0);

    // REAL: return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  // ===== ИСТОРИЯ ОПЕРАЦИЙ =====

  getOperations(cardId: number): Observable<CardOperation[]> {
    const ops = this.mockOperations.filter(o => o.cardId === cardId);
    return of(ops);
    // REAL: return this.http.get<CardOperation[]>(`${this.apiUrl}/${cardId}/operations`);
  }

  // ===== СИНХРОНИЗАЦИЯ С КЭШЕМ (для MQTT) =====

  /** Обновить баланс карты напрямую (например, после сканирования через MQTT) */
  updateBalanceByNumber(cardNumber: string, newBalance: number): void {
    const normalized = String(cardNumber || '').trim().toUpperCase();
    const idx = this.mockCards.findIndex(c => c.number.toUpperCase() === normalized);
    if (idx < 0) return;

    this.mockCards[idx] = {
      ...this.mockCards[idx],
      balance: Math.round(Number(newBalance) * 100) / 100
    };
    this.cardsSubject.next([...this.mockCards]);
  }

  /** Получить снимок локального кэша */
  snapshot(): ClientCard[] {
    return [...this.mockCards];
  }
}