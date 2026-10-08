// frontend/src/app/features/reports/report-list/report-list.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  ReceiptService,
  GroupedReport,
  GroupedDay,
  GroupedPost,
  GroupedPaymentMethod,
} from '../../../core/services/receipt.service';

type Period = 'day' | 'week' | 'month' | 'shift' | 'custom';

@Component({
  selector: 'app-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-list.component.html',
  styleUrls: ['./report-list.component.scss'],
})
export class ReportListComponent implements OnInit {
  private receiptService = inject(ReceiptService);
  private http = inject(HttpClient);

  report: GroupedReport | null = null;
  loading = false;
  errorMsg = '';

  period: Period = 'day';
  dateFrom = '';
  dateTo = '';

  private currentShiftOpenedAt: string | null = null;

  ngOnInit(): void {
    this.http.get<any>('/api/kkm/current-shift').subscribe({
      next: (s) => {
        if (s && s.exists !== false && s.openedAt) {
          this.currentShiftOpenedAt = s.openedAt;
        }
        this.setPeriod('day');
      },
      error: () => this.setPeriod('day'),
    });
  }

  // ============================================================
  // Периоды
  // ============================================================
  setPeriod(p: Period): void {
    this.period = p;

    const now = new Date();
    let start: Date;
    let end: Date;

    if (p === 'shift') {
      if (!this.currentShiftOpenedAt) {
        this.errorMsg = 'Смена не открыта';
        this.report = null;
        return;
      }
      // Точно от openedAt до сейчас, БЕЗ обрезки до 00:00
      start = new Date(this.currentShiftOpenedAt);
      end   = new Date();
    } else {
      start = new Date(now);
      end   = new Date(now);
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
        case 'custom':
          this.load();
          return;
      }
    }

    this.dateFrom = this.toInputDate(start);
    this.dateTo = this.toInputDate(end);
    this.load(start, end);
  }

  onCustomRangeChange(): void {
    this.period = 'custom';
    this.load();
  }

  // ============================================================
  // Хелперы rowspan
  // ============================================================
  countDayRows(day: GroupedDay): number {
    let n = 0;
    for (const post of day.posts) {
      n += this.countPostRows(post) + 1;
    }
    return n + 1;
  }

  countPostRows(post: GroupedPost): number {
    let n = 0;
    for (const pm of post.paymentMethods) {
      n += this.countPmRows(pm) + 1;
    }
    return n + 1;
  }

  countPmRows(pm: GroupedPaymentMethod): number {
    let n = 0;
    for (const rcp of pm.receipts) {
      n += rcp.items.length + 1;
    }
    return n + 1;
  }

  formatTime(totalSec: number): string {
    const s = Math.round(totalSec || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ============================================================
  // Загрузка / PDF
  // ============================================================
  private load(startInput?: Date, endInput?: Date): void {
    let start: Date;
    let end: Date;

    if (startInput && endInput) {
      // Явный диапазон (day/week/month/shift) — НЕ трогаем часы
      start = new Date(startInput);
      end   = new Date(endInput);
    } else {
      // Ручной диапазон — обрезаем по дню
      start = this.dateFrom ? new Date(this.dateFrom) : new Date(0);
      start.setHours(0, 0, 0, 0);
      end = this.dateTo ? new Date(this.dateTo) : new Date();
      end.setHours(23, 59, 59, 999);
    }

    this.loading = true;
    this.errorMsg = '';

    this.receiptService.loadGrouped(start, end).subscribe({
      next: (r) => {
        this.report = r;
        this.loading = false;
      },
      error: (err) => {
        console.error('[reports] grouped load failed:', err);
        this.report = null;
        this.errorMsg = 'Не удалось загрузить отчёт';
        this.loading = false;
      },
    });
  }

  downloadPdf(): void {
    if (!this.dateFrom || !this.dateTo) return;

    let start: Date;
    let end: Date;

    if (this.period === 'shift' && this.currentShiftOpenedAt) {
      start = new Date(this.currentShiftOpenedAt);
      end   = new Date();
    } else {
      start = new Date(this.dateFrom);
      start.setHours(0, 0, 0, 0);
      end = new Date(this.dateTo);
      end.setHours(23, 59, 59, 999);
    }

    this.receiptService.downloadPdf(start, end).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_${this.dateFrom}_${this.dateTo}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      error: (err) => {
        console.error('[reports] pdf download failed:', err);
        this.errorMsg = 'Не удалось скачать PDF';
      },
    });
  }

  private toInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}