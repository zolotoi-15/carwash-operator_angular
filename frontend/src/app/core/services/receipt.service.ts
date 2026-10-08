// frontend/src/app/core/services/receipt.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, map } from 'rxjs';
import { ReceiptData, ReceiptServiceLine } from '../models/receipt.model';

export interface GroupedItem {
  name: string;
  pricePerSecond: number;
  quantity: number;
  unit: string;
  timeWorkedSec: number;
  sum: number;
}

export interface GroupedReceipt {
  receiptNumber: number;
  date: string | Date;
  postId: number;
  paymentMethod: string;
  total: number;
  items: GroupedItem[];
}

export interface GroupedPaymentMethod {
  paymentMethod: string;
  total: number;
  count: number;
  receipts: GroupedReceipt[];
}

export interface GroupedPost {
  postId: number;
  total: number;
  count: number;
  paymentMethods: GroupedPaymentMethod[];
}

export interface GroupedDay {
  date: string;
  total: number;
  count: number;
  posts: GroupedPost[];
}

export interface GroupedReport {
  from: string;
  to: string;
  grandTotal: number;
  grandCount: number;
  days: GroupedDay[];
}

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  private http = inject(HttpClient);

  private receiptsSubject = new BehaviorSubject<ReceiptData[]>([]);
  receipts$ = this.receiptsSubject.asObservable();

  private receipts: ReceiptData[] = [];
  private nextId = 1;

  // ============================================================
  // Загрузка за период — плоский список
  // ============================================================
  load(from?: Date, to?: Date, postId?: number): Observable<ReceiptData[]> {
    let params = new HttpParams();
    if (from)   params = params.set('from', from.toISOString());
    if (to)     params = params.set('to',   to.toISOString());
    if (postId) params = params.set('postId', String(postId));

    return this.http.get<any>('/api/reports/range', { params }).pipe(
      map(res => {
        const raw = Array.isArray(res) ? res : (res?.receipts ?? []);
        let list = raw.map((r: any) => this.normalize(r));
        if (postId) list = list.filter((r: ReceiptData) => r.postId === Number(postId));
        return list;
      }),
      tap(list => {
        this.receipts = list;
        this.receiptsSubject.next([...this.receipts]);
      }),
    );
  }

  // ============================================================
  // Сгруппированный отчёт — с полным ISO-datetime
  // ============================================================
  loadGrouped(from: Date, to: Date): Observable<GroupedReport> {
    const params = new HttpParams()
      .set('from', from.toISOString())
      .set('to',   to.toISOString());

    return this.http.get<GroupedReport>('/api/reports/grouped', { params });
  }

  // ============================================================
  // Скачивание PDF
  // ============================================================
  downloadPdf(from: Date, to: Date): Observable<Blob> {
    const params = new HttpParams()
      .set('from', from.toISOString())
      .set('to',   to.toISOString());

    return this.http.get('/api/reports/pdf', {
      params,
      responseType: 'blob',
    });
  }

  // ============================================================
  // Локальный кэш
  // ============================================================
  getReceipts(): Observable<ReceiptData[]> {
    return this.receiptsSubject.asObservable();
  }

  addReceipt(raw: any): ReceiptData {
    const receipt = this.normalize(raw);
    this.receipts.unshift(receipt);
    if (this.receipts.length > 500) this.receipts.pop();
    this.receiptsSubject.next([...this.receipts]);
    return receipt;
  }

  getReceiptsForPeriod(start: Date, end: Date): ReceiptData[] {
    const s = start.getTime();
    const e = end.getTime();
    return this.receipts.filter(r => {
      const t = new Date(r.date).getTime();
      return t >= s && t <= e;
    });
  }

  clear(): void {
    this.receipts = [];
    this.receiptsSubject.next([]);
  }

  getLastReceipt(): ReceiptData | null {
    return this.receipts[0] || null;
  }

  getTotalForToday(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.receipts
      .filter(r => new Date(r.date) >= today)
      .reduce((sum, r) => sum + (r.total || 0), 0);
  }

  private normalize(raw: any): ReceiptData {
    const rawLines = raw.services || raw.items || [];

    const services: ReceiptServiceLine[] = rawLines.map((it: any) => ({
      name:           String(it.name || ''),
      pricePerSecond: Number(it.pricePerSecond) || 0,
      seconds:        Number(it.seconds) || 0,
      total:          Number(it.total != null ? it.total : it.cost) || 0,
    }));

    const totalSum = services.reduce((s, l) => s + l.total, 0);

    const total = raw.total != null
      ? Number(raw.total)
      : (raw.totalCost != null
          ? Number(raw.totalCost)
          : Math.round(totalSum * 100) / 100);

    const dateStr = raw.date
      ? String(raw.date)
      : (raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString());

    return {
      id:            raw.id != null ? Number(raw.id) : (raw._id ?? this.nextId++),
      receiptNumber: Number(raw.receiptNumber) || 0,
      postId:        Number(raw.postId) || 0,
      date:          dateStr,
      total,
      services,
      fiscal:        !!(raw.fiscalSent || raw.fiscal),
    };
  }
}

export { ReceiptItem } from '../models/receipt.model';