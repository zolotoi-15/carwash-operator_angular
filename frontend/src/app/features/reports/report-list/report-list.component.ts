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

type Period = 'day' | 'yesterday' | 'week' | 'month' | 'shift' | 'custom';
export type ViewMode = 'table' | 'receipts';

interface KpiCards {
  total: number;
  receiptsCount: number;
  avgCheck: number;
  cash: number;
  cashPct: number;
  noncash: number;
  noncashPct: number;
}

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

  period: Period = 'shift';
  dateFrom = '';
  dateTo = '';

  viewMode: ViewMode = 'table';
  search = '';

  kpi: KpiCards = { total: 0, receiptsCount: 0, avgCheck: 0, cash: 0, cashPct: 0, noncash: 0, noncashPct: 0 };
  paymentSlices: { label: string; value: number; pct: number; color: string }[] = [];
  donutStyle = '';
  postBars: { postId: number; sum: number; count: number; pct: number }[] = [];

  expanded: Record<string, boolean> = {};

  // ★ Инициализируем значениями по умолчанию, чтобы rangeLabel()
  //   не падал при первом рендере, пока идёт HTTP-запрос смены.
  start: Date = new Date();
  end: Date = new Date();

  private currentShiftOpenedAt: string | null = null;

  private static readonly PAY_COLORS: Record<string, string> = {
    cash: '#2e7d32', client_card: '#1565c0', card: '#1976d2',
    sbp: '#6a1b9a', qr: '#8e24aa', online: '#00838f', other: '#757575',
  };

  ngOnInit(): void {
    this.loadCurrentShiftAndReport();
  }

  loadCurrentShiftAndReport(): void {
    this.http.get<any>('/api/kkm/current-shift').subscribe({
      next: (s) => {
        if (s && s.exists !== false && s.openedAt) {
          this.currentShiftOpenedAt = s.openedAt;
          this.setPeriod('shift');
        } else {
          this.currentShiftOpenedAt = null;
          this.setPeriod('day');
        }
      },
      error: () => {
        this.currentShiftOpenedAt = null;
        this.setPeriod('day');
      },
    });
  }

  refresh(): void {
    if (this.period === 'shift') this.loadCurrentShiftAndReport();
    else this.load();
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
        this.setPeriod('day');
        return;
      }
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
        case 'yesterday':
          start.setDate(now.getDate() - 1);
          end.setDate(now.getDate() - 1);
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

  setViewMode(m: ViewMode): void {
    this.viewMode = m;
  }

  toggleReceipt(key: string): void {
    this.expanded[key] = !this.expanded[key];
  }

  payLabel(pm: string | null | undefined): string {
    switch (pm) {
      case 'cash': return '💵 Наличные';
      case 'client_card': return '💳 Карта клиента';
      case 'card': return '💳 Безнал';
      case 'sbp': return '🔗 СБП';
      case 'qr': return '🔗 СБП (QR)';
      case 'online': return '🌐 Онлайн';
      case 'topup': return '💰 Пополнение';
      case 'post_balance': return '🔁 Перевод с поста';
      case null:
      case undefined:
      case '': return '—';
      default: return pm;
    }
  }

  periodLabel(): string {
    switch (this.period) {
      case 'shift': return 'Текущая смена';
      case 'day': return 'Сегодня';
      case 'yesterday': return 'Вчера';
      case 'week': return 'Последняя неделя';
      case 'month': return 'Текущий месяц';
      case 'custom': return 'Произвольный период';
    }
  }

  rangeLabel(): string {
    // ★ Защита от undefined/null — на случай, если шаблон отрендерится
    //   раньше, чем придёт ответ HTTP и установятся start/end.
    const f = (d: Date | null | undefined): string => {
      if (!d) return '—';
      return d.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    };
    return `${f(this.start)} — ${f(this.end)}`;
  }

  /** Плоский список чеков для режима «Чеки» (с учётом поиска) */
  get flatReceipts(): any[] {
    if (!this.report) return [];
    const out: any[] = [];
    const q = this.search.trim().toLowerCase();
    for (const day of this.report.days) {
      for (const post of day.posts) {
        for (const pm of post.paymentMethods) {
          for (const rcp of pm.receipts) {
            if (q) {
              const hay = `${rcp.receiptNumber} ${post.postId} ${rcp.items.map((i: any) => i.name).join(' ')}`.toLowerCase();
              if (!hay.includes(q)) continue;
            }
            out.push({ ...rcp, postId: post.postId, paymentMethod: pm.paymentMethod, date: day.date });
          }
        }
      }
    }
    return out.sort((a, b) => (b.time || b.timestamp || '').localeCompare(a.time || a.timestamp || ''));
  }

  /** Чеки, проходящие поиск (для фильтрации таблицы) */
  receiptMatchesSearch(rcp: any): boolean {
    const q = this.search.trim().toLowerCase();
    if (!q) return true;
    const hay = `${rcp.receiptNumber} ${rcp.items.map((i: any) => i.name).join(' ')}`.toLowerCase();
    return hay.includes(q);
  }

  trackDay(_: number, day: GroupedDay): string { return day.date; }

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
      start = new Date(startInput);
      end   = new Date(endInput);
    } else {
      start = this.dateFrom ? new Date(this.dateFrom) : new Date(0);
      start.setHours(0, 0, 0, 0);
      end = this.dateTo ? new Date(this.dateTo) : new Date();
      end.setHours(23, 59, 59, 999);
    }

    this.start = start;
    this.end = end;

    this.loading = true;
    this.errorMsg = '';

    this.receiptService.loadGrouped(start, end).subscribe({
      next: (r) => {
        this.report = r;
        this.computeAnalytics();
        this.loading = false;
      },
      error: (err) => {
        console.error('[reports] grouped load failed:', err);
        this.report = null;
        this.kpi = { total: 0, receiptsCount: 0, avgCheck: 0, cash: 0, cashPct: 0, noncash: 0, noncashPct: 0 };
        this.paymentSlices = [];
        this.postBars = [];
        this.donutStyle = '';
        this.errorMsg = 'Не удалось загрузить отчёт. Проверьте, что сервер запущен.';
        this.loading = false;
      },
    });
  }

  /** KPI + диаграммы по загруженной группировке */
  private computeAnalytics(): void {
    const rep = this.report;
    if (!rep) return;

    let total = rep.grandTotal ?? 0;
    let count = rep.grandCount ?? 0;

    const payMap = new Map<string, number>();
    const postMap = new Map<number, { sum: number; count: number }>();

    for (const day of rep.days) {
      for (const post of day.posts) {
        let postSum = 0;
        for (const pm of post.paymentMethods) {
          const pmSum = pm.receipts.reduce((s, r) => s + (r.total ?? 0), 0);
          payMap.set(pm.paymentMethod || 'other', (payMap.get(pm.paymentMethod || 'other') || 0) + pmSum);
          postSum += pmSum;
        }
        const prev = postMap.get(post.postId) || { sum: 0, count: 0 };
        prev.sum += postSum;
        prev.count += post.paymentMethods.reduce((s, pm) => s + pm.receipts.length, 0);
        postMap.set(post.postId, prev);
      }
    }

    const cash = payMap.get('cash') || 0;
    const noncash = total - cash;

    this.kpi = {
      total,
      receiptsCount: count,
      avgCheck: count > 0 ? total / count : 0,
      cash,
      cashPct: total > 0 ? Math.round((cash / total) * 100) : 0,
      noncash,
      noncashPct: total > 0 ? Math.round((noncash / total) * 100) : 0,
    };

    const slices: { label: string; value: number; pct: number; color: string }[] = [];
    const sortedPay = [...payMap.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, value] of sortedPay) {
      if (value <= 0) continue;
      const pct = total > 0 ? (value / total) * 100 : 0;
      slices.push({
        label: this.payLabel(key),
        value,
        pct,
        color: ReportListComponent.PAY_COLORS[key] || ReportListComponent.PAY_COLORS['other'],
      });
    }
    this.paymentSlices = slices;

    let cum = 0;
    const stops: string[] = [];
    for (const s of slices) {
      const from = cum;
      cum += (s.value / (total || 1)) * 100;
      stops.push(`${s.color} ${from}% ${Math.min(cum, 100)}%`);
    }
    this.donutStyle = slices.length ? `background: conic-gradient(${stops.join(', ')})` : '';

    const maxPost = Math.max(...[...postMap.values()].map(p => p.sum), 1);
    this.postBars = [...postMap.entries()]
      .map(([postId, v]) => ({ postId, sum: v.sum, count: v.count, pct: Math.round((v.sum / maxPost) * 100) }))
      .sort((a, b) => b.sum - a.sum);
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