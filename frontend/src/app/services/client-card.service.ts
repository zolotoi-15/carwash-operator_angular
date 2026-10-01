import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { HttpParams } from '@angular/common/http';
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

  // Поиск по номеру карты, ФИО или телефону
searchCards(query: string): Observable<ClientCard[]> {
  const params = new HttpParams().set('q', query);
  return this.http.get<ClientCard[]>(`${this.apiUrl}/search`, { params });
}

// Обновление ФИО и/или телефона
updateCardInfo(card: string, data: { fullName?: string; phone?: string }): Observable<ClientCard> {
  return this.http.patch<ClientCard>(`${this.apiUrl}/${card}`, data);
}

// Детальная отчетность по карте (операции, пополнения и т.д.)
getCardReport(card: string, dateFrom?: string, dateTo?: string): Observable<any> {
  let params = new HttpParams();
  if (dateFrom) params = params.set('from', dateFrom);
  if (dateTo)   params = params.set('to', dateTo);
  return this.http.get(`${this.apiUrl}/${card}/report`, { params });
}
  
}
