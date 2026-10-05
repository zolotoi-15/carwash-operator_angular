import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

// ✅ Точные типы из модели
import {
  ReceiptData,
  ReceiptServiceLine,
} from '../models/receipt.model';

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  private receiptsSubject = new BehaviorSubject<ReceiptData[]>([]);
  private receipts: ReceiptData[] = [];
  private nextId = 1;

  getReceipts(): Observable<ReceiptData[]> {
    return this.receiptsSubject.asObservable();
  }

  /**
   * Принимает «сырой» объект от MQTT или HTTP и приводит к ReceiptData.
   * Поддерживает как raw.items[] с { name, cost, ... }, так и raw.services[]
   * с { name, total, ... }.
   */
  addReceipt(raw: any): ReceiptData {
    const rawLines = raw.services || raw.items || [];

    const services: ReceiptServiceLine[] = rawLines.map((it: any) => ({
      name: String(it.name || ''),
      pricePerSecond: Number(it.pricePerSecond) || 0,
      seconds: Number(it.seconds) || 0,
      // В модели поле называется total; поддерживаем оба варианта входа
      total: Number(it.total != null ? it.total : it.cost) || 0,
    }));

    const total = services.reduce((sum: number, line: ReceiptServiceLine) => sum + line.total, 0);
    const rounded = Math.round(total * 100) / 100;

    // date — строка ISO
    const dateStr: string = raw.date
      ? String(raw.date)
      : (raw.timestamp
          ? (raw.timestamp instanceof Date
              ? raw.timestamp.toISOString()
              : String(raw.timestamp))
          : new Date().toISOString());

    const receipt: ReceiptData = {
      id: raw.id != null ? Number(raw.id) : this.nextId++,
      receiptNumber: Number(raw.receiptNumber) || 0,
      postId: Number(raw.postId) || 0,
      date: dateStr,
      total: rounded,
      services,
      fiscal: !!raw.fiscal,
    };

    this.receipts.unshift(receipt);
    if (this.receipts.length > 500) this.receipts.pop();
    this.receiptsSubject.next([...this.receipts]);

    console.log(`🧾 Receipt saved (post ${receipt.postId}, ${rounded} ₽)`);
    return receipt;
  }

  /** Используется в report-list.component.ts */
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
      .reduce((sum: number, r: ReceiptData) => sum + (r.total || 0), 0);
  }
}

// ✅ Реэкспорт для local-post.service.ts, где используется
// `import { ReceiptService, ReceiptItem as LocalReceiptItem } from './receipt.service'`
export { ReceiptItem } from '../models/receipt.model';