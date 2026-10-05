import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ShiftService } from '../../../services/shift.service';
import { ReceiptService } from '../../../services/receipt.service';
import { CashShift } from '../../../models/shift.model';

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="reports">
      <h1>📄 Отчёты</h1>

      <div class="filters">
        <label>С даты:</label>
        <input type="date" [(ngModel)]="fromDate" (change)="refresh()" />
        <label>По дату:</label>
        <input type="date" [(ngModel)]="toDate" (change)="refresh()" />
        <button (click)="refresh()">Обновить</button>
      </div>

      <div class="totals">
        <div class="card">
          <span>Выручка за период</span>
          <strong>{{ total }} ₽</strong>
        </div>
        <div class="card">
          <span>Чеков</span>
          <strong>{{ count }}</strong>
        </div>
        <div class="card">
          <span>Смена сейчас</span>
          <strong>{{ currentShift ? 'Открыта' : 'Закрыта' }}</strong>
          <small *ngIf="currentShift">
            с {{ currentShift.openedAt | date:'HH:mm' }}
          </small>
        </div>
      </div>

      <h2>Чеки</h2>
      <table>
        <thead>
          <tr>
            <th>Дата</th><th>Пост</th><th>Сумма</th><th>Операция</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let r of receipts">
            <td>{{ r.timestamp | date:'dd.MM.yyyy HH:mm' }}</td>
            <td>Пост {{ r.postId }}</td>
            <td>{{ r.totalCash | number:'1.2-2' }} ₽</td>
            <td>{{ r.operation || '—' }}</td>
          </tr>
          <tr *ngIf="!receipts.length">
            <td colspan="4" style="text-align:center;color:#94a3b8;padding:24px">
              Нет чеков за период
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    h1 { color: #1e293b; }
    .filters { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; }
    .filters input { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; }
    .filters button { padding: 8px 16px; background: #0ea5e9; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    .totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card span { display: block; font-size: 13px; color: #64748b; margin-bottom: 8px; }
    .card strong { font-size: 24px; color: #1e293b; }
    .card small { display: block; color: #94a3b8; margin-top: 4px; }
    h2 { color: #1e293b; font-size: 18px; margin-top: 24px; }
    table { width: 100%; background: #fff; border-collapse: collapse; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; color: #475569; font-weight: 600; }
  `]
})
export class ReportListComponent implements OnInit, OnDestroy {
  fromDate = '';
  toDate = '';
  total = 0;
  count = 0;
  receipts: any[] = [];
  currentShift: CashShift | null = null;
  private subs: Subscription[] = [];

  constructor(
    private shiftService: ShiftService,
    private receiptService: ReceiptService
  ) {}

  ngOnInit(): void {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    this.fromDate = first.toISOString().slice(0, 10);
    this.toDate = today.toISOString().slice(0, 10);

    this.subs.push(this.receiptService.getReceipts().subscribe(list => {
      this.receipts = list;
      this.refresh();
    }));
    this.subs.push(this.shiftService.currentShift$.subscribe(s => this.currentShift = s));
    this.shiftService.getCurrentShift().subscribe();
    this.refresh();
  }

  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  refresh(): void {
    const start = new Date(this.fromDate + 'T00:00:00');
    const end = new Date(this.toDate + 'T23:59:59');
    const list = this.receiptService.getReceiptsForPeriod(start, end);
    this.total = list.reduce((s, r) => s + r.totalCash, 0);
    this.count = list.length;
    this.receipts = list;
  }
}