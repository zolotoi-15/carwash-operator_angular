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
  template: `
    <div class="report-wrapper">
      <!-- ===== Шапка с градиентом ===== -->
      <div class="report-header">
        <div class="header-left">
          <h2 class="header-title">📊 Отчёт по сменам и выручке</h2>
          <p class="header-sub">Аналитика работы автомойки в реальном времени</p>
        </div>
        <div class="header-actions">
          <button class="btn-export" (click)="exportCSV()">📥 Экспорт CSV</button>
          <button class="btn-print" (click)="print()">🖨️ Печать</button>
          <button class="btn-refresh" (click)="refresh()" [disabled]="loading">{{ loading ? '⏳ Загрузка…' : '🔄 Обновить' }}</button>
        </div>
      </div>

      <!-- ===== Сообщение об ошибке ===== -->
      @if (error) {
        <div class="error-banner">⚠️ {{ error }} <button class="retry" (click)="refresh()">Повторить</button></div>
      }

      <!-- ===== Переключатель периодов ===== -->
      <div class="period-tabs">
        @for (p of periods; track p.value) {
          <button
            class="tab"
            [class.active]="period() === p.value"
            (click)="setPeriod(p.value)">
            {{ p.icon }} {{ p.label }}
          </button>
        }
      </div>

      <!-- ===== KPI-карточки ===== -->
      <div class="kpi-grid">
        <div class="kpi-card kpi-revenue">
          <div class="kpi-icon">💰</div>
          <div class="kpi-body">
            <div class="kpi-label">Выручка</div>
            <div class="kpi-value">{{ totals.revenue | number:'1.0-0' }} ₽</div>
            <div class="kpi-delta neutral">{{ lastUpdated ? 'обновлено в ' + (lastUpdated | date:'HH:mm') : 'загрузка…' }}</div>
          </div>
        </div>

        <div class="kpi-card kpi-check">
          <div class="kpi-icon">🧾</div>
          <div class="kpi-body">
            <div class="kpi-label">Средний чек</div>
            <div class="kpi-value">{{ totals.avgCheck | number:'1.0-0' }} ₽</div>
            <div class="kpi-delta neutral">за период</div>
          </div>
        </div>

        <div class="kpi-card kpi-receipts">
          <div class="kpi-icon">📋</div>
          <div class="kpi-body">
            <div class="kpi-label">Количество чеков</div>
            <div class="kpi-value">{{ totals.receipts }}</div>
            <div class="kpi-delta neutral">за период</div>
          </div>
        </div>

        <div class="kpi-card kpi-top">
          <div class="kpi-icon">🏆</div>
          <div class="kpi-body">
            <div class="kpi-label">Топ-услуга</div>
            <div class="kpi-value small">{{ topService }}</div>
            <div class="kpi-delta neutral">{{ topCount }} заказов</div>
          </div>
        </div>
      </div>

      <!-- ===== Таблица услуг ===== -->
      <div class="table-card">
        <div class="table-header">
          <h3>🧼 Услуги за период</h3>
          <div class="search-box">
            <input
              type="text"
              placeholder="🔍 Поиск услуги..."
              [(ngModel)]="search"
              class="search-input" />
          </div>
        </div>

        <div class="table-wrap">
          <table class="report-table">
            <thead>
              <tr>
                <th>Услуга</th>
                <th class="num">Кол-во</th>
                <th class="num">Сумма</th>
                <th class="bar">Доля</th>
              </tr>
            </thead>
            <tbody>
              @for (row of filteredRows(); track row.service) {
                <tr>
                  <td class="svc">
                    <span class="svc-icon">{{ row.icon }}</span>
                    {{ row.service }}
                  </td>
                  <td class="num">{{ row.count }}</td>
                  <td class="num money">{{ row.sum | number:'1.0-0' }} ₽</td>
                  <td class="bar">
                    <div class="bar-bg">
                      <div
                        class="bar-fill"
                        [style.width.%]="percent(row.sum)"
                        [style.background]="barColor(row.sum)">
                      </div>
                    </div>
                    <span class="bar-label">{{ percent(row.sum).toFixed(1) }}%</span>
                  </td>
                </tr>
              }
              @empty {
                <tr>
                  <td colspan="4" class="empty">
                    😔 Нет данных за выбранный период
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td><strong>ИТОГО</strong></td>
                <td class="num"><strong>{{ totals.receipts }}</strong></td>
                <td class="num money"><strong>{{ totals.revenue | number:'1.0-0' }} ₽</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* ===== Обёртка ===== */
    .report-wrapper {
      padding: 20px;
      max-width: 1400px;
      margin: 0 auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* ===== Шапка ===== */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: linear-gradient(135deg, #6d28d9 0%, #3b82f6 100%);
      color: #fff;
      padding: 24px 28px;
      border-radius: 14px;
      margin-bottom: 20px;
      box-shadow: 0 8px 24px rgba(109, 40, 217, 0.25);
    }
    .header-title {
      margin: 0 0 4px;
      font-size: 22px;
      font-weight: 700;
    }
    .header-sub {
      margin: 0;
      font-size: 13px;
      color: #e9d5ff;
    }
    .header-actions {
      display: flex;
      gap: 10px;
    }
    .btn-export, .btn-print {
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.3);
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      backdrop-filter: blur(10px);
    }
    .btn-export:hover, .btn-print:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-1px);
    }

    /* ===== Вкладки периодов ===== */
    .period-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      background: #f1f5f9;
      padding: 6px;
      border-radius: 12px;
      width: fit-content;
    }
    .tab {
      padding: 10px 20px;
      border: none;
      background: transparent;
      color: #64748b;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .tab:hover {
      color: #334155;
      background: rgba(255, 255, 255, 0.6);
    }
    .tab.active {
      background: #fff;
      color: #6d28d9;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    /* ===== KPI-сетка ===== */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: #fff;
      border-radius: 14px;
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      border: 1px solid #e2e8f0;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
    }
    .kpi-icon {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      flex-shrink: 0;
    }
    .kpi-revenue .kpi-icon { background: linear-gradient(135deg, #10b981, #059669); }
    .kpi-check .kpi-icon { background: linear-gradient(135deg, #3b82f6, #2563eb); }
    .kpi-receipts .kpi-icon { background: linear-gradient(135deg, #8b5cf6, #6d28d9); }
    .kpi-top .kpi-icon { background: linear-gradient(135deg, #f59e0b, #d97706); }
    .kpi-body { flex: 1; min-width: 0; }
    .kpi-label {
      font-size: 12px;
      color: #64748b;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .kpi-value {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.2;
    }
    .kpi-value.small { font-size: 18px; }
    .kpi-delta {
      font-size: 11px;
      margin-top: 4px;
      font-weight: 600;
    }
    .kpi-delta.positive { color: #10b981; }
    .kpi-delta.neutral { color: #94a3b8; }

    /* ===== Таблица ===== */
    .table-card {
      background: #fff;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
      border: 1px solid #e2e8f0;
    }
    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 24px;
      border-bottom: 1px solid #e2e8f0;
    }
    .table-header h3 {
      margin: 0;
      font-size: 16px;
      color: #0f172a;
      font-weight: 700;
    }
    .search-input {
      padding: 8px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      width: 240px;
      transition: border-color 0.2s;
    }
    .search-input:focus {
      border-color: #6d28d9;
      box-shadow: 0 0 0 3px rgba(109, 40, 217, 0.1);
    }
    .table-wrap {
      overflow-x: auto;
    }
    .report-table {
      width: 100%;
      border-collapse: collapse;
    }
    .report-table thead {
      background: #f8fafc;
    }
    .report-table th {
      padding: 14px 20px;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #e2e8f0;
    }
    .report-table th.num { text-align: right; }
    .report-table td {
      padding: 16px 20px;
      font-size: 14px;
      color: #334155;
      border-bottom: 1px solid #f1f5f9;
    }
    .report-table tbody tr {
      transition: background 0.15s;
    }
    .report-table tbody tr:hover {
      background: #f8fafc;
    }
    .report-table td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .report-table td.money {
      font-weight: 600;
      color: #0f172a;
    }
    .svc {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .svc-icon {
      width: 32px;
      height: 32px;
      background: #f1f5f9;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }
    .bar {
      width: 200px;
    }
    .bar-bg {
      height: 8px;
      background: #f1f5f9;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s ease;
    }
    .bar-label {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
    }
    .empty {
      text-align: center;
      padding: 40px !important;
      color: #94a3b8;
      font-size: 14px;
    }
    .report-table tfoot td {
      background: #f8fafc;
      font-size: 14px;
      padding: 16px 20px;
      border-top: 2px solid #e2e8f0;
    }

    /* ===== Адаптив ===== */
    @media (max-width: 1024px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .bar { width: 140px; }
    }
    @media (max-width: 640px) {
      .report-header { flex-direction: column; gap: 16px; align-items: flex-start; }
      .header-actions { width: 100%; }
      .btn-export, .btn-print { flex: 1; }
      .kpi-grid { grid-template-columns: 1fr; }
      .period-tabs { width: 100%; overflow-x: auto; }
      .tab { white-space: nowrap; }
      .bar { display: none; }
    }

    /* ===== Печать ===== */
    @media print {
      .report-header, .period-tabs, .header-actions, .search-box { display: none !important; }
      .report-wrapper { padding: 0; }
      .kpi-card, .table-card { box-shadow: none; border: 1px solid #ccc; break-inside: avoid; }
    }
  `]
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