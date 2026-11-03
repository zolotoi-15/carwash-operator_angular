import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { RealtimeService, RealtimeMessage } from '../../../core/services/realtime.service';

@Component({
  selector: 'app-shift-total',
  standalone: true,
  imports: [CommonModule],
  // Добавляем стили для хоста, чтобы компонент занимал всю ячейку грида
  host: {
    style: 'display: flex; width: 100%; height: 100%; min-width: 0;'
  },
  template: `
    <div class="card">
      <h3 class="card-title">💰 Общая сумма за смену ККМ</h3>
      <div class="amount">{{ total | number:'1.2-2' }} ₽</div>
      <div class="receipts-count">Количество чеков: {{ count }}</div>
    </div>
  `,
  styles: [`
    .card {
      flex: 1;               /* Растягиваем карточку по доступному пространству */
      width: 100%;           /* Занимаем всю ширину ячейки грида */
      height: 100%;          /* Занимаем всю высоту */
      box-sizing: border-box;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: #fff;
      border-radius: 10px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .card-title { 
      margin: 0 0 12px; 
      font-size: 15px; 
      color: #dbeafe; 
    }
    .amount {
      font-size: 36px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 8px;
      line-height: 1;
    }
    .receipts-count { 
      font-size: 13px; 
      color: #dbeafe; 
    }
  `]
})
export class ShiftTotalComponent implements OnInit, OnDestroy {
  private realtime = inject(RealtimeService);
  total = 0;
  count = 0;
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.realtime.messages$.subscribe((msg: RealtimeMessage) => {
      if (msg.type === 'mqtt' && msg.topic === 'shift/total') {
        try {
          const data = JSON.parse(msg.payload || '{}');
          this.total = Number(data.total) || 0;
          this.count = Number(data.count) || 0;
        } catch {
          /* ignore */
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}