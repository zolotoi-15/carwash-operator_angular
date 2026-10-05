// src/app/features/reports/report-list/report-list.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReceiptService } from '../../core/services/receipt.service';

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="reports">
      <h2>📊 Отчёты по кассовым чекам</h2>
      <div class="filters">
        <button (click)="setPeriod('day')">День</button>
        <button (click)="setPeriod('week')">Неделя</button>
        <button (click)="setPeriod('month')">Месяц</button>
        <button (click)="setPeriod('shift')">Смена (8-20)</button>
        <input type="date" [(ngModel)]="dateFrom" />
        <input type="date" [(ngModel)]="dateTo" />
        <button (click)="loadReport()">Показать</button>
        <button (click)="downloadPdf()">📄 Скачать PDF</button>
      </div>
      <p>Итого: {{ total | number:'1.2-2' }} руб., чеков: {{ receipts.length }}</p>
      <table>
        <thead>
          <tr>
            <th>№</th><th>№ чека</th><th>Пост</th><th>Дата</th><th>Сумма</th><th>Услуги</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let r of receipts; let i = index">
            <td>{{ i + 1 }}</td>
            <td>{{ r.receiptNumber }}</td>
            <td>{{ r.postId }}</td>
            <td>{{ r.date | date:'dd.MM.yy HH:mm' }}</td>
            <td>{{ r.total | number:'1.2-2' }} ₽</td>
            <td>{{ r.services }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `
})
export class ReportListComponent implements OnInit {
  receipts: any[] = [];
  total = 0;
  dateFrom = '';
  dateTo = '';

  constructor(private receiptService: ReceiptService) {}

  ngOnInit(): void {
    this.loadReport();
  }

  setPeriod(period: string): void {
    // вычисление диапазона дат и вызов loadReport()
  }

  loadReport(): void {
    this.receiptService.getReceipts({ from: this.dateFrom, to: this.dateTo }).subscribe(data => {
      this.receipts = data;
      this.total = data.reduce((sum, r) => sum + r.total, 0);
    });
  }

  downloadPdf(): void {
    // вызов сервиса генерации PDF
  }
}