import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { MqttService } from '../../../core/services/mqtt.service';

@Component({
  selector: 'app-shift-total',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <h3 class="card-title">💰 Общая сумма за смену ККМ</h3>
      <div class="amount">{{ total | number:'1.2-2' }} ₽</div>
      <div class="receipts-count">Количество чеков: {{ count }}</div>
    </div>
  `,
  styles: [`
  :host {
    display: flex;
    width: 100%;
    min-width: 0;
    height: 100%;
  }
  .card {
    flex: 1;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    color: #fff;
    border-radius: 10px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
  }
  .card-title { margin: 0 0 10px; font-size: 15px; color: #dbeafe; font-weight: 600; }
  .amount { font-size: 40px; font-weight: 700; color: #fff; margin-bottom: 8px; line-height: 1; }
  .receipts-count { font-size: 13px; color: #dbeafe; }
`]
})
export class ShiftTotalComponent implements OnInit, OnDestroy {
  private mqtt = inject(MqttService);

  total = 0;
  count = 0;

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.mqtt.getShiftTotalUpdates().subscribe((data: any) => {
      this.total = Number(data?.totalCash ?? data?.total ?? 0);
      this.count = Number(data?.receiptCount ?? data?.count ?? 0);
    });

    // Mock
    this.total = 10863.10;
    this.count = 42;
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }
}