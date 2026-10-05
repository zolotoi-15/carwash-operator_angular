// src/app/pages/card-report/card-report.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { ClientCardService, CardReportResponse } from '../../core/services/client-card.service';
import { CardOperation, CardReportSummary } from '../../models/client-card.model';

@Component({
  selector: 'app-card-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './card-report.component.html',
  styleUrls: ['./card-report.component.scss'],
})
export class CardReportComponent implements OnInit {
  cardNumber = '';
  dateFrom?: string;
  dateTo?: string;

  summary: CardReportSummary | null = null;
  operations: CardOperation[] = [];

  loading = false;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cardService: ClientCardService,
  ) {}

  ngOnInit(): void {
    this.cardNumber = (this.route.snapshot.paramMap.get('card') || '').toUpperCase();
    this.reload();
  }

  reload(): void {
    if (!this.cardNumber) {
      this.error = 'Не указан номер карты';
      return;
    }
    this.loading = true;
    this.error = null;

    this.cardService
      .getCardReport(this.cardNumber, this.dateFrom, this.dateTo)
      .subscribe({
        next: (resp: CardReportResponse) => {
          this.summary = resp.summary;
          this.operations = resp.operations;
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.error || 'Не удалось загрузить отчёт';
          this.loading = false;
        },
      });
  }

  exportCsv(): void {
    if (!this.operations.length) return;

    const header = ['Дата', 'Тип', 'Сумма', 'Баланс после', 'Пост', 'Чек', 'Оператор'];
    const rows = this.operations.map((op) => [
      new Date(op.date).toLocaleString('ru-RU'),
      op.type,
      String(op.amount),
      String(op.balanceAfter),
      op.postId || '',
      op.receiptNumber || '',
      op.operatorName || '',
    ]);

    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `card-${this.cardNumber}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  back(): void {
    this.router.navigate(['/cards']);
  }
}