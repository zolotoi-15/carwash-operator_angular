import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ReceiptData, ReceiptFilter } from '../models/receipt.model';

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/receipts`;

  private receiptsSubject = new BehaviorSubject<ReceiptData[]>([]);
  readonly receipts$ = this.receiptsSubject.asObservable();

  // ==== Приём чеков из MQTT ====
  addReceipt(data: any): void {
    const receipt: ReceiptData = {
      id: Date.now(),
      receiptNumber: Number(data.receiptNumber ?? data.number ?? 0),
      postId: Number(data.postId ?? 0),
      date: data.date ?? new Date().toISOString(),
      total: Number(data.totalCash ?? data.total ?? 0),
      services: (data.items ?? []).map((it: any) => ({
        name: String(it.name ?? ''),
        pricePerSecond: Number(it.pricePerSecond ?? 0),
        seconds: Number(it.seconds ?? 0),
        total: Number(it.cost ?? 0)
      })),
      fiscal: !!data.fiscal
    };

    const current = this.receiptsSubject.value;
    this.receiptsSubject.next([receipt, ...current]);
  }

  // ==== API ====
  getReceipts(filter?: ReceiptFilter): Observable<ReceiptData[]> {
    // MOCK: если фильтра нет — вернуть локальные
    if (!filter || (!filter.from && !filter.to && !filter.postId)) {
      return of(this.receiptsSubject.value);
    }
    return of(this.receiptsSubject.value);
    // REAL: return this.http.get<ReceiptData[]>(this.apiUrl, { params: filter as any });
  }

  getAll(): ReceiptData[] {
    return this.receiptsSubject.value;
  }

  clear(): void {
    this.receiptsSubject.next([]);
  }
}