// src/app/services/receipt.service.ts

import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ReceiptItem {
  name: string;        // название услуги
  seconds: number;     // время работы в секундах
  cost: number;        // стоимость в рублях
  pricePerSecond: number;
  receiptNumber?: number; // <-- добавить
}

export interface Receipt {
  postId: number;
  balance: number;
  totalCash: number;
  items: ReceiptItem[];
  timestamp?: string;
  operation?: string;
}

@Injectable({ providedIn: 'root' })
export class ReceiptService {
  private receipts: Receipt[] = [];
  private receiptsSubject = new BehaviorSubject<Receipt[]>([]);
  private storageKey = 'carwash_receipts';

  constructor() {
    this.loadFromStorage();
  }

  getReceipts() {
    return this.receiptsSubject.asObservable();
  }

  addReceipt(receipt: Receipt) {
    // Добавляем временную метку, если её нет
    if (!receipt.timestamp) {
      receipt.timestamp = new Date().toISOString();
    }
    this.receipts.push(receipt);
    this.saveToStorage();
    this.receiptsSubject.next([...this.receipts]);
  }

  getTotals() {
    const total = this.receipts.reduce((sum, r) => sum + r.totalCash, 0);
    const count = this.receipts.length;
    return { total, count };
  }

  getReceiptsForPeriod(start: Date, end: Date): Receipt[] {
    return this.receipts.filter(r => {
      const d = new Date(r.timestamp!);
      return d >= start && d <= end;
    });
  }

  private saveToStorage() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.storageKey, JSON.stringify(this.receipts));
    }
  }

  private loadFromStorage() {
    if (typeof window !== 'undefined') {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        try {
          this.receipts = JSON.parse(data);
          this.receiptsSubject.next([...this.receipts]);
        } catch (e) {
          console.error('Ошибка загрузки чеков из localStorage', e);
        }
      }
    }
  }

  // Метод для получения всех чеков (используется в компоненте отчётов)
  getAllReceipts(): Receipt[] {
    return this.receipts;
  }

  clearReceipts() {
    this.receipts = [];
    this.saveToStorage();
    this.receiptsSubject.next([]);
  }
}
