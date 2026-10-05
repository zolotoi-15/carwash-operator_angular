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
  readonly receipts$: Observable<ReceiptData[]> = this.receiptsSubject.asObservable();

  // ================= MOCK =================
  constructor() {
    // Пустой старт. Чеки приходят из MQTT через addReceipt().
    // Для отладки можно раскомментировать:
    // this.seedMockReceipts();
  }

  // ================= INGEST (из MQTT) =================

  /**
   * Принять чек, пришедший из MQTT-топика kkm/print.
   */
  addReceipt(data: any): void {
    const items = (data.items ?? []).map((it: any) => ({
      name: String(it.name ?? ''),
      pricePerSecond: Number(it.pricePerSecond ?? 0),
      seconds: Number(it.seconds ?? 0),
      total: Number(it.cost ?? 0)
    }));

    const receipt: ReceiptData = {
      id: Date.now(),
      receiptNumber: Number(data.receiptNumber ?? data.number ?? 0),
      postId: Number(data.postId ?? 0),
      date: data.date ?? new Date().toISOString(),
      total: Number(data.totalCash ?? data.total ?? 0),
      services: items,
      fiscal: !!data.fiscal
    };

    const current = this.receiptsSubject.value;
    this.receiptsSubject.next([receipt, ...current]);
  }

  // ================= READ =================

  getReceipts(filter?: ReceiptFilter): Observable<ReceiptData[]> {
    if (!filter || (!filter.from && !filter.to && !filter.postId)) {
      return of(this.receiptsSubject.value);
    }
    return of(this.filterInternal(filter));
    // REAL: return this.http.get<ReceiptData[]>(this.apiUrl, { params: filter as any });
  }

  /** Синхронный доступ ко всем чекам */
  getAll(): ReceiptData[] {
    return this.receiptsSubject.value;
  }

  /**
   * Чеки за период. Принимает Date или строку (ISO или 'YYYY-MM-DD').
   * Возвращает синхронно — удобно для отчётов и reduce().
   */
  getReceiptsForPeriod(from: Date | string, to: Date | string): ReceiptData[] {
    const fromTs = new Date(from).getTime();
    const toTs = new Date(to).getTime();
    return this.receiptsSubject.value.filter(r => {
      const ts = new Date(r.date).getTime();
      return ts >= fromTs && ts <= toTs;
    });
  }

  /**
   * То же, но возвращает Observable — если понадобится реактивность.
   */
  getReceiptsForPeriod$(
    from: Date | string,
    to: Date | string
  ): Observable<ReceiptData[]> {
    return of(this.getReceiptsForPeriod(from, to));
  }

  // ================= FILTERING =================

  private filterInternal(filter: ReceiptFilter): ReceiptData[] {
    let list = this.receiptsSubject.value;

    if (filter.postId != null) {
      list = list.filter(r => r.postId === filter.postId);
    }
    if (filter.from) {
      const fromTs = new Date(filter.from).getTime();
      list = list.filter(r => new Date(r.date).getTime() >= fromTs);
    }
    if (filter.to) {
      const toTs = new Date(filter.to).getTime();
      list = list.filter(r => new Date(r.date).getTime() <= toTs);
    }
    return list;
  }

  // ================= CLEAR =================

  clear(): void {
    this.receiptsSubject.next([]);
  }

  // ================= MOCK (для отладки) =================

  private seedMockReceipts(): void {
    const now = new Date();
    const mock: ReceiptData[] = [
      {
        id: 1,
        receiptNumber: 1497,
        postId: 1,
        date: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
        total: 150.00,
        services: [
          { name: 'Вода',      pricePerSecond: 0.5, seconds: 5.0,   total: 2.50 },
          { name: 'Пена',      pricePerSecond: 0.7, seconds: 12.0,  total: 8.40 },
          { name: 'Тефлон',    pricePerSecond: 0.8, seconds: 156.6, total: 125.30 },
          { name: 'Антимошка', pricePerSecond: 0.8, seconds: 1.0,   total: 0.80 },
          { name: 'Шампунь',   pricePerSecond: 0.7, seconds: 2.0,   total: 1.40 },
          { name: 'Турбо',     pricePerSecond: 0.6, seconds: 10.0,  total: 5.80 },
          { name: 'Пылесос',   pricePerSecond: 0.3, seconds: 23.0,  total: 5.80 }
        ]
      },
      {
        id: 2,
        receiptNumber: 1496,
        postId: 1,
        date: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        total: 10.00,
        services: [
          { name: 'Воск',   pricePerSecond: 0.8, seconds: 4.0, total: 3.00 },
          { name: 'Тефлон', pricePerSecond: 0.8, seconds: 8.8, total: 7.00 }
        ]
      }
    ];
    this.receiptsSubject.next(mock);
  }
}