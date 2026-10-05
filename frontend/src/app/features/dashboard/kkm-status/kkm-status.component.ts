import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { MqttService } from '../../../core/services/mqtt.service';

@Component({
  selector: 'app-kkm-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card kkm-card">
      <h3 class="card-title">📟 Кассовый аппарат (ККМ)</h3>

      <div class="kkm-row">
        <span class="label">Состояние:</span>
        <span class="value" [class.ok]="kkm.ready" [class.err]="!kkm.ready">
          {{ kkm.ready ? '✅ Готов' : '⚠️ Не отвечает' }}
        </span>
      </div>

      <div class="kkm-row">
        <span class="label">Подключение:</span>
        <span class="value" [class.ok]="kkm.connected" [class.err]="!kkm.connected">
          {{ kkm.connected ? '🟢 Да' : '🔴 Нет' }}
        </span>
      </div>

      <div class="kkm-row">
        <span class="label">Бумага:</span>
        <span class="value">{{ kkm.paper ? '📄 Есть' : '❌ Нет' }}</span>
      </div>

      <div class="kkm-row">
        <span class="label">Номер ККТ:</span>
        <span class="value mono">{{ kkm.number || '—' }}</span>
      </div>

      <div class="kkm-row">
        <span class="label">Фискальная смена №:</span>
        <span class="value mono">{{ kkm.shiftNumber }}</span>
      </div>

      <div class="kkm-row">
        <span class="label">Кассир:</span>
        <span class="value">{{ kkm.cashier || '—' }}</span>
      </div>

      <div class="warning" *ngIf="!kkm.ready">
        ⚠️ ККМ не отвечает, используются ручные настройки
      </div>
    </div>
  `,
  styles: [`
    .card { background: #6d28d9; color: #e9d5ff; border-radius: 10px; padding: 16px; }
    .card-title { margin: 0 0 12px; font-size: 15px; color: #fff; }
    .kkm-row {
      display: flex; justify-content: space-between;
      padding: 6px 0; font-size: 13px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .kkm-row:last-of-type { border-bottom: none; }
    .label { color: #c4b5fd; }
    .value { color: #fff; font-weight: 500; }
    .value.ok { color: #4ade80; }
    .value.err { color: #fca5a5; }
    .mono { font-family: ui-monospace, monospace; font-size: 12px; }
    .warning {
      margin-top: 12px; padding: 8px 10px;
      background: rgba(0,0,0,0.2);
      border-radius: 6px; font-size: 12px; color: #fde68a;
    }
  `]
})
export class KkmStatusComponent implements OnInit, OnDestroy {
  private mqtt = inject(MqttService);

  kkm = {
    ready: false,
    connected: false,
    paper: false,
    number: '',
    shiftNumber: 0,
    cashier: ''
  };

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.mqtt.getShiftTotalUpdates().subscribe((data: any) => {
      this.kkm = {
        ready: !!data?.kkmReady,
        connected: !!data?.kkmConnected,
        paper: !!data?.paper,
        number: data?.kkmNumber ?? '',
        shiftNumber: data?.shiftNumber ?? 0,
        cashier: data?.cashier ?? ''
      };
    });

    // Mock для демонстрации, пока MQTT не подключён
    this.kkm = {
      ready: true,
      connected: true,
      paper: true,
      number: '0000111118041361',
      shiftNumber: 0,
      cashier: 'Оператор'
    };
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}