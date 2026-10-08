// frontend/src/app/features/dashboard/kkm-status/kkm-status.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { RealtimeService, RealtimeMessage } from '../../../core/services/realtime.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-kkm-status',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kkm-status.component.html',
  styleUrls: ['./kkm-status.component.scss'],
})
export class KkmStatusComponent implements OnInit, OnDestroy {
  private realtime = inject(RealtimeService);
  private http     = inject(HttpClient);
  private notify   = inject(NotificationService);

  kkm = {
    ready:              false,
    connected:          false,
    paper:              false,
    number:             '',
    shiftNumber:        0,
    cashier:            '',
    shiftOpened:        false,
    shiftOpenedAt:      null as string | null,
    shiftAutoCloseAt:   null as string | null,
    currentShiftNumber: 0,
    driverOnline:       false,
  };

  busy = false;

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.realtime.messages$.subscribe((msg: RealtimeMessage) => {
      if (msg.type === 'mqtt' && msg.topic === 'kkm/status') {
        try {
          const d = JSON.parse(msg.payload || '{}');
          this.kkm = {
            ready:              !!d.ready,
            connected:          !!d.connected,
            paper:              !!d.paper,
            number:             d.kkNumber || d.number || '',
            shiftNumber:        Number(d.shiftNumber) || 0,
            cashier:            d.cashier || d.cashierName || '',
            shiftOpened:        !!d.shiftOpened,
            shiftOpenedAt:      d.shiftOpenedAt || null,
            shiftAutoCloseAt:   d.shiftAutoCloseAt || null,
            currentShiftNumber: Number(d.currentShiftNumber) || 0,
            driverOnline:       !!d.driverOnline,
          };
        } catch { /* ignore */ }
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Сколько часов осталось до автозакрытия */
  get hoursLeft(): number {
    if (!this.kkm.shiftAutoCloseAt) return -1;
    const diff = new Date(this.kkm.shiftAutoCloseAt).getTime() - Date.now();
    return diff / 3600_000;
  }

  // ============================================================
  // Действия
  // ============================================================
  openShift(): void {
    this.busy = true;
    this.http.post<any>('/api/kkm/open-shift', {}).subscribe({
      next: (r) => {
        this.notify.success(`Смена №${r.shiftNumber} открыта`);
        this.busy = false;
      },
      error: (err) => {
        this.notify.error(err?.error?.error || 'Не удалось открыть смену');
        this.busy = false;
      },
    });
  }

  xReport(): void {
    this.busy = true;
    this.http.get<any>('/api/kkm/x-report').subscribe({
      next: (r) => {
        this.notify.success(`X-отчёт: ${r.total.toFixed(2)} ₽, чеков ${r.count}`);
        this.busy = false;
      },
      error: (err) => {
        this.notify.error(err?.error?.error || 'Не удалось сформировать X-отчёт');
        this.busy = false;
      },
    });
  }

  zReport(): void {
    if (!confirm('Закрыть смену и сформировать Z-отчёт?')) return;
    this.busy = true;
    this.http.post<any>('/api/kkm/z-report', {}).subscribe({
      next: (r) => {
        this.notify.success(
          `Z-отчёт: ${r.closed.total.toFixed(2)} ₽, чеков ${r.closed.count}. ` +
          `Открыта новая смена №${r.newShift.shiftNumber}`
        );
        this.busy = false;
      },
      error: (err) => {
        this.notify.error(err?.error?.error || 'Не удалось закрыть смену');
        this.busy = false;
      },
    });
  }
}