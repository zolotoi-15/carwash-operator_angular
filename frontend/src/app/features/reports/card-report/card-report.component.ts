import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RealtimeService, RealtimeMessage } from '../../../core/services/realtime.service';
import { Subscription, firstValueFrom } from 'rxjs';

export interface ReportRow {
  service: string;
  count: number;
  sum: number;
  icon: string;
}

export type Period = 'shift' | 'day' | 'week' | 'month';

@Component({
  selector: 'app-card-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  host: {
    style: 'display: block; width: 100%;'
  },
  templateUrl: './card-report.component.html',
  styleUrl: './card-report.component.scss',
})
export class CardReportComponent implements OnInit, OnDestroy {
  private realtime = inject(RealtimeService);
  private http = inject(HttpClient);
  private sub?: Subscription;

  period = signal<Period>('shift');
  search = '';
  loading = false;
  error = '';
  lastUpdated: Date | null = null;
  // '—' пока данные не загружены; реальные значения приходят с бэкенда
  shiftDelta: string | null = null;

  periods: { value: Period; label: string; icon: string }[] = [
    { value: 'shift', label: 'Текущая смена', icon: '🕐' },
    { value: 'day',   label: 'День',          icon: '📅' },
    { value: 'week',  label: 'Неделя',        icon: '📆' },
    { value: 'month', label: 'Месяц',         icon: '🗓️' }
  ];

  rows: ReportRow[] = [];

  totals = { revenue: 0, avgCheck: 0, receipts: 0 };
  topService = '—';
  topCount = 0;

  rangeStart: Date | null = null;
  rangeEnd: Date | null = null;

  periodLabel(): string {
    switch (this.period()) {
      case 'shift': return 'Текущая смена';
      case 'day': return 'Сегодня';
      case 'week': return 'Последняя неделя';
      case 'month': return 'Текущий месяц';
    }
  }

  rangeLabel(): string {
    if (!this.rangeStart || !this.rangeEnd) return '';
    const f = (d: Date) => d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `${f(this.rangeStart)} — ${f(this.rangeEnd)}`;
  }

  ngOnInit(): void {
    this.load();
    this.sub = this.realtime.messages$.subscribe((msg: RealtimeMessage) => {
      if (msg.type === 'mqtt' && (msg.topic === 'shift/total' || msg.topic === 'kkm/print')) {
        this.load();
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  setPeriod(p: Period): void {
    this.period.set(p);
    this.load();
  }

  /** Диапазон дат для выбранного периода */
  private range(): { from: Date; to: Date } | null {
    const now = new Date();
    const to = now;
    let from: Date;
    switch (this.period()) {
      case 'day':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        from = new Date(now); from.setDate(from.getDate() - 6);
        from.setHours(0, 0, 0, 0);
        break;
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'shift':
      default:
        return null; // обрабатывается в load() через /api/kkm/current-shift
    }
    return { from, to };
  }

  /** Загрузка реальных данных с бэкенда (/api/reports/range) */
  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      let from: Date;
      let to: Date = new Date();

      if (this.period() === 'shift') {
        // период по умолчанию — текущая открытая смена; fallback — текущий день
        let openedAt: string | null = null;
        try {
          const shift = await firstValueFrom<any>(this.http.get('/api/kkm/current-shift'));
          if (shift && shift.exists !== false && shift.openedAt) openedAt = shift.openedAt;
        } catch { /* смена недоступна — fallback на день */ }
        if (openedAt) {
          from = new Date(openedAt);
        } else {
          from = new Date(); from.setHours(0, 0, 0, 0);
        }
      } else {
        const r = this.range()!;
        from = r.from; to = r.to;
      }

      const res = await firstValueFrom<any>(
        this.http.get('/api/reports/range', {
          params: { from: from.toISOString(), to: to.toISOString() },
        })
      );

      this.rangeStart = from;
      this.rangeEnd = to;

      const receipts: any[] = Array.isArray(res) ? res : (res?.receipts ?? []);
      const agg = new Map<string, { count: number; sum: number }>();
      let revenue = 0;

      for (const rc of receipts) {
        // итоговые чеки услуг (operation 'sell'/нет поля); пополнения баланса — отдельная агрегация
        const isTopup = rc.operation === 'topup';
        revenue += Number(rc.totalCost) || 0;
        const items: any[] = rc.items || [];
        if (!items.length) continue;
        for (const it of items) {
          const key = isTopup ? '💳 Пополнение баланса' : (it.name || 'Услуга');
          const cur = agg.get(key) || { count: 0, sum: 0 };
          cur.count += 1;
          cur.sum += Number(it.cost) || 0;
          agg.set(key, cur);
        }
      }

      this.rows = [...agg.entries()]
        .map(([service, v]) => ({ service, count: v.count, sum: Math.round(v.sum * 100) / 100, icon: this.iconFor(service) }))
        .sort((a, b) => b.sum - a.sum);

      this.totals.revenue = Math.round(revenue * 100) / 100;
      this.totals.receipts = receipts.length;
      this.totals.avgCheck = receipts.length ? Math.round(revenue / receipts.length) : 0;
      const top = [...this.rows].sort((a, b) => b.count - a.count)[0];
      this.topService = top?.service.replace(/^[^\p{L}]+/u, '').trim() || '—';
      this.topCount = top?.count || 0;
      this.lastUpdated = new Date();
    } catch (e: any) {
      this.error = 'Не удалось загрузить данные отчёта. Проверьте подключение к серверу.';
    } finally {
      this.loading = false;
      this.recalc();
    }
  }

  private iconFor(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('пополн')) return '💳';
    if (n.includes('премиум') || n.includes('люкс')) return '✨';
    if (n.includes('стандарт') || n.includes('комплекс')) return '🚿';
    if (n.includes('пылесос')) return '🧹';
    if (n.includes('шин') || n.includes('чернен')) return '🛞';
    if (n.includes('салон') || n.includes('хим')) return '🪑';
    if (n.includes('воск') || n.includes('полир')) return '🧴';
    return '💧';
  }

  refresh(): void {
    this.load();
  }

  private recalc(): void {
    this.totals.revenue = this.rows.reduce((s, r) => s + r.sum, 0) || this.totals.revenue;
    const top = [...this.rows].sort((a, b) => b.count - a.count)[0];
    this.topService = top?.service.replace(/^[^\p{L}]+/u, '').trim() || '—';
    this.topCount = top?.count || 0;
  }

  filteredRows = () => {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.rows;
    return this.rows.filter(r => r.service.toLowerCase().includes(q));
  };

  percent(sum: number): number {
    return this.totals.revenue ? (sum / this.totals.revenue) * 100 : 0;
  }

  barColor(sum: number): string {
    const p = this.percent(sum);
    if (p > 25) return 'linear-gradient(90deg, #6d28d9, #8b5cf6)';
    if (p > 15) return 'linear-gradient(90deg, #3b82f6, #60a5fa)';
    if (p > 8) return 'linear-gradient(90deg, #10b981, #34d399)';
    return 'linear-gradient(90deg, #f59e0b, #fbbf24)';
  }

  exportCSV(): void {
    const header = 'Услуга;Количество;Сумма\n';
    const body = this.rows
      .map(r => `${r.service};${r.count};${r.sum}`)
      .join('\n');
    const blob = new Blob(['\uFEFF' + header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${this.period()}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  print(): void {
    window.print();
  }
}
