// src/app/pages/dashboard/shift-total.component.ts
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { ReceiptService } from '../../services/receipt.service';
import { MqttService } from '../../services/mqtt.service';

@Component({
  selector: 'app-shift-total',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="shift-total-card">
      <h3>💰 Общая сумма за смену ККМ</h3>
      <div class="total-amount">{{ total.toFixed(2) }} ₽</div>
      <div class="receipts-count">Количество чеков: {{ count }}</div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .shift-total-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 16px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      flex: 1;
    }
    .shift-total-card h3 {
      font-size: 1.2rem;
      margin: 0 0 0.5rem 0;
      text-align: right;
    }
    .total-amount {
      font-size: 2rem;
      font-weight: bold;
      margin: 0.5rem 0;
      text-align: right;
    }
    .receipts-count {
      font-size: 1rem;
      opacity: 0.9;
      text-align: right;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShiftTotalComponent implements OnInit, OnDestroy {
  total: number = 0;
  count: number = 0;
  private subs: Subscription = new Subscription();

  constructor(
    private receiptService: ReceiptService,
    private mqtt: MqttService,
    private http: HttpClient,        // добавить
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    // Загружаем итоги смены с сервера при старте
    this.http.get('/api/shift-total').subscribe({
      next: (data: any) => {
        this.total = data.total || 0;
        this.count = data.count || 0;
        this.cdr.markForCheck();
      },
      error: (err) => console.warn('⚠️ Ошибка загрузки итогов смены', err)
    });

    // Подписка на MQTT-обновления
    this.subs.add(
      this.mqtt.getShiftTotalUpdates().subscribe(data => {
        if (data && data.total !== undefined) {
          this.total = data.total;
          this.count = data.count;
          this.cdr.markForCheck();
        }
      })
    );

    // Дополнительно подписываемся на локальные чеки (для автономного режима)
    this.subs.add(
      this.receiptService.getReceipts().subscribe(() => {
        const totals = this.receiptService.getTotals();
        this.total = totals.total;
        this.count = totals.count;
        this.cdr.markForCheck();
      })
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
