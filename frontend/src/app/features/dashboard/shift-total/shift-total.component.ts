// src/app/features/dashboard/shift-total/shift-total.component.ts
import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { RealtimeService, RealtimeMessage } from '../../../core/services/realtime.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-shift-total',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <h3 class="card-title">💰 Общая сумма за смену ККМ</h3>
      <div class="amount">{{ total | number:'1.2-2' }} ₽</div>
      
      <div class="receipts-count">
        Количество чеков: {{ count }}
      </div>
      <div class="avg-check">
        📈 Средний чек: {{ avgCheck | number:'1.2-2' }} ₽
      </div>

      <!-- ★ Блок способов оплаты -->
      <div class="payment-methods" *ngIf="paymentMethods">
        <h4 class="pm-title">Способы оплаты</h4>
        
        <div class="pm-row">
          <span class="pm-name">💵 Наличные</span>
          <span class="pm-sum">{{ paymentMethods.cash.total | number:'1.2-2' }} ₽</span>
          <span class="pm-percent">{{ paymentMethods.cash.percent }}%</span>
        </div>
        
        <div class="pm-row">
          <span class="pm-name">💳 Безнал</span>
          <span class="pm-sum">{{ paymentMethods.card_terminal.total | number:'1.2-2' }} ₽</span>
          <span class="pm-percent">{{ paymentMethods.card_terminal.percent }}%</span>
        </div>
        
        <div class="pm-row">
          <span class="pm-name">💳 Карта клиента</span>
          <span class="pm-sum">{{ paymentMethods.client_card.total | number:'1.2-2' }} ₽</span>
          <span class="pm-percent">{{ paymentMethods.client_card.percent }}%</span>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./shift-total.component.scss'],
  host: {
    style: 'display: flex; width: 100%; height: 100%; min-width: 0;'
  }
})
export class ShiftTotalComponent implements OnInit, OnDestroy {
  private realtime = inject(RealtimeService);
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private apiUrl = `${environment.apiUrl}`;

  total = 0;
  count = 0;
  avgCheck = 0;
  
  // ★ Добавляем структуру для способов оплаты
  paymentMethods: any = {
    cash: { total: 0, percent: 0 },
    card_terminal: { total: 0, percent: 0 },
    client_card: { total: 0, percent: 0 }
  };

  private sub?: Subscription;

  ngOnInit(): void {
    this.loadInitialData();

    this.sub = this.realtime.messages$.subscribe((msg: RealtimeMessage) => {
      if (msg.type === 'mqtt' && msg.topic === 'shift/total') {
        try {
          const data = JSON.parse(msg.payload || '{}');
          this.total = Number(data.total) || 0;
          this.count = Number(data.count) || 0;
          this.avgCheck = Number(data.avgCheck) || 0;
          if (data.paymentMethods) {
            this.paymentMethods = data.paymentMethods;
          }
          this.cdr.detectChanges();
        } catch { /* ignore */ }
      }
    });
  }

  private loadInitialData(): void {
    const token = localStorage.getItem('carwash_auth_token') || '';
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);

    this.http.get<any>(`${this.apiUrl}/shift-total`, { headers }).subscribe({
      next: (data) => {
        this.total = data.total || 0;
        this.count = data.count || 0;
        this.avgCheck = data.avgCheck || 0;
        if (data.paymentMethods) {
          this.paymentMethods = data.paymentMethods;
        }
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Ошибка загрузки суммы смены:', err)
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}