import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription, interval } from 'rxjs';
import { AdminService } from '../../core/servicesadmin.service';

@Component({
  selector: 'app-kkm-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="kkm-status-card" [class.ready]="kkmStatus.ready" [class.error]="kkmStatus.errors.length > 0">
      <h3>🧾 Кассовый аппарат (ККМ)</h3>
      <div class="status-line"><span>Состояние:</span><strong>{{ kkmStatus.ready ? '✅ Готов' : '❌ Не готов' }}</strong></div>
      <div class="status-line"><span>Подключение:</span><strong>{{ kkmStatus.connected ? '🟢 Да' : '🔴 Нет' }}</strong></div>
      <div class="status-line"><span>Бумага:</span><strong>{{ kkmStatus.paper ? '📄 Есть' : '⚠️ Нет' }}</strong></div>
      <div class="status-line"><span>Номер ККТ:</span><strong>{{ kkmStatus.kkNumber || '—' }}</strong></div>
      <div class="status-line"><span>Фискальная смена №:</span><strong>{{ kkmStatus.shiftNumber ?? '—' }}</strong></div>
      <div class="status-line"><span>Кассир:</span><strong>{{ kkmStatus.cashierName || '—' }}</strong></div>
      <div *ngIf="kkmStatus.lastReceipt" class="status-line"><span>Последний чек:</span><strong>{{ kkmStatus.lastReceipt | date:'HH:mm:ss dd.MM.yy' }}</strong></div>
      <div *ngIf="kkmStatus.errors.length > 0" class="errors"><div *ngFor="let err of kkmStatus.errors">⚠️ {{ err }}</div></div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .kkm-status-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 16px;
      padding: 10px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .kkm-status-card h3 { font-size: 1.2rem; margin: 0 0 0.5rem 0; text-align: left; }
    .status-line { display: flex; justify-content: space-between; margin: 5px 0; font-size: 0.9rem; }
    .errors { color: #ffcccc; margin-top: 8px; font-size: 0.8rem; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KkmStatusComponent implements OnInit, OnDestroy {
  kkmStatus: any = {
    ready: false,
    connected: false,
    paper: true,
    kkNumber: null,
    shiftNumber: null,
    cashierName: null,
    lastReceipt: null,
    errors: []
  };
  private subs: Subscription = new Subscription();

  constructor(
    private http: HttpClient,
    private admin: AdminService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.loadStatus();
    this.subs.add(interval(30000).subscribe(() => this.loadStatus()));
  }

  loadStatus() {
    this.http.get<any>('/api/kkm/status').subscribe({
      next: (data) => {
        // Поддержка двух вариантов имени поля: kktNumber (от бэкенда) или kkNumber
        const kkNumber = data.kkNumber || data.kktNumber;
        // Считаем, что ККМ подключён, если connected === true И (есть номер ККТ ИЛИ смена !== null)
        // shiftNumber может быть 0, это допустимое значение (смена закрыта)
        const isConnected = data && data.connected === true && (kkNumber || data.shiftNumber !== undefined);

        if (isConnected) {
          this.kkmStatus = {
            ready: data.ready ?? true,
            connected: true,
            paper: data.paper ?? true,
            kkNumber: kkNumber || null,
            shiftNumber: data.shiftNumber ?? null,   // 0 — допустимо
            cashierName: data.cashierName || null,
            lastReceipt: data.lastReceipt || null,
            errors: data.errors || []
          };
        } else {
          // Если бэкенд не подтвердил подключение — используем ручные настройки
          this.admin.getSettings().subscribe(settings => {
            this.kkmStatus = {
              ready: data?.ready ?? true,
              connected: false,
              paper: data?.paper ?? true,
              kkNumber: settings.kkmManual?.kkNumber || null,
              shiftNumber: settings.kkmManual?.fiscalShiftNumber ?? null,
              cashierName: settings.kkmManual?.cashierName || null,
              lastReceipt: data?.lastReceipt || null,
              errors: data?.errors?.length ? data.errors : ['ККМ не подключён, используются ручные настройки']
            };
            this.cdr.markForCheck();
          });
          return;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Ошибка получения статуса ККМ', err);
        this.admin.getSettings().subscribe(settings => {
          this.kkmStatus = {
            ready: true,
            connected: false,
            paper: true,
            kkNumber: settings.kkmManual?.kkNumber || null,
            shiftNumber: settings.kkmManual?.fiscalShiftNumber ?? null,
            cashierName: settings.kkmManual?.cashierName || null,
            lastReceipt: null,
            errors: ['Драйвер ККМ недоступен, используются ручные настройки']
          };
          this.cdr.markForCheck();
        });
      }
    });
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
