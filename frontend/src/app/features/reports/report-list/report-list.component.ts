import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ReceiptService } from '../../../core/services/receipt.service';
import { ShiftService } from '../../../core/services/shift.service';
import { ReceiptData } from '../../../core/models/receipt.model';
import { CashShift } from '../../../core/models/shift.model';

type Period = 'day' | 'week' | 'month' | 'shift' | 'custom';

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="reports-page">
      <h2>📊 Отчёты по кассовым чекам</h2>

      <div class="filters">
        <button [class.active]="period === 'day'"    (click)="setPeriod('day')">День</button>
        <button [class.active]="period === 'week'"   (click)="setPeriod('week')">Неделя</button>
        <button [class.active]="period === 'month'"  (click)="setPeriod('month')">Месяц</button>
        <button [class.active]="period === 'shift'"  (click)="setPeriod('shift')">Смена (8–20)</button>

        <span class="range-label">Диапазон:</span>
        <input type="date" [(ngModel)]="dateFrom" (change)="onCustomRangeChange()" />
        <input type="date" [(ngModel)]="dateTo"   (change)="onCustomRangeChange()" />

        <button class="pdf-btn" (click)="downloadPdf()">📄 Скачать PDF</button>
      </div>

      <p class="summary">
        Итого: <strong>{{ total | number:'1.2-2' }}</strong> руб.,
        чеков: <strong>{{ receipts.length }}</strong>
      </p>

      <table class="receipts-table">
        <thead>
          <tr>
            <th>№</th>
            <th>№ чека</th>
            <th>Пост</th>
            <th>Дата</th>
            <th>Сумма</th>
            <th>Услуги</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let r of receipts; let i = index">
            <td>{{ i + 1 }}</td>
            <td>{{ r.receiptNumber }}</td>
            <td>{{ r.postId }}</td>
            <td>{{ r.date | date:'dd.MM.yy HH:mm' }}</td>
            <td class="amount">{{ r.total | number:'1.2-2' }} ₽</td>
            <td class="services">
              <span *ngFor="let svc of r.services; let last = last">
                {{ svc.name }} (цена сек: {{ svc.pricePerSecond }}коп,
                время: {{ svc.seconds }}с,
                сумма: {{ svc.total | number:'1.2-2' }})<span *ngIf="!last">, </span>
              </span>
            </td>
          </tr>
          <tr *ngIf="!receipts.length">
            <td colspan="6" class="empty">Нет чеков за выбранный период</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .reports-page { padding: 24px; }
    .filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
    .filters button { padding: 6px 12px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; }
    .filters button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
    .range-label { margin-left: 12px; color: #64748b; font-size: 13px; }
    .filters input[type=date] { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px; }
    .pdf-btn { margin-left: auto; }
    .summary { margin: 16px 0; font-size: 15px; }
    .receipts-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .receipts-table th, .receipts-table td { padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    .receipts-table th { background: #f8fafc; font-weight: 600; }
    .amount { font-weight: 500; white-space: nowrap; }
    .services { font-size: 12px; color: #475569; max-width: 480px; }
    .empty { text-align: center; color: #94a3b8; padding: 24px; }
  `]
})
export class ReportListComponent implements OnInit, OnDestroy {
  private receiptService = inject(ReceiptService);
  private shiftService = inject(ShiftService);

  receipts: ReceiptData[] = [];
  total = 0;
  currentShift: CashShift | null = null;

  period: Period = 'day';
  dateFrom = '';
  dateTo = '';

  private subs = new Subscription();

  ngOnInit(): void {
    this.setPeriod('day');

    this.subs.add(
      this.shiftService.currentShift$.subscribe(s => {
        this.currentShift = s;
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ================= PERIOD =================

  setPeriod(p: Period): void {
    this.period = p;

    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    switch (p) {
      case 'day':
        start.setHours(0, 0, 0, 0);
        break;
      case 'week':
        start.setDate(now.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        break;
      case 'month':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case 'shift':
        start.setHours(8, 0, 0, 0);
        end.setHours(20, 0, 0, 0);
        break;
      case 'custom':
        // диапазон выбран вручную — используем dateFrom/dateTo
        this.loadReport();
        return;
    }

    this.dateFrom = this.toInputDate(start);
    this.dateTo = this.toInputDate(end);
    this.loadReport();
  }

  onCustomRangeChange(): void {
    this.period = 'custom';
    this.loadReport();
  }

  // ================= DATA =================

  private loadReport(): void {
    const start = this.dateFrom ? new Date(this.dateFrom) : new Date(0);
    const end = this.dateTo ? new Date(this.dateTo) : new Date();
    end.setHours(23, 59, 59, 999);

    const list = this.receiptService.getReceiptsForPeriod(start, end);
    this.receipts = list;
    this.total = list.reduce((sum, r) => sum + (r.total ?? 0), 0);
  }

  downloadPdf(): void {
    // TODO: подключить сервис генерации PDF
    console.log('Скачивание PDF:', {
      period: this.period,
      from: this.dateFrom,
      to: this.dateTo,
      receipts: this.receipts.length,
      total: this.total
    });
  }

  // ================= HELPERS =================

  private toInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}