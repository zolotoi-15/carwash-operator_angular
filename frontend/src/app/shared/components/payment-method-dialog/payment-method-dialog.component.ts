// frontend/src/app/shared/components/payment-method-dialog/payment-method-dialog.component.ts
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type PaymentMethod = 'cash' | 'card_terminal';

@Component({
  selector: 'app-payment-method-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pm-backdrop" (click)="onCancel()"></div>
    <div class="pm-dialog" role="dialog" aria-modal="true">
      <div class="pm-header">
        <h3>Способ оплаты</h3>
        <button class="pm-close" (click)="onCancel()" aria-label="Закрыть">✕</button>
      </div>

      <div class="pm-body">
        <div class="pm-amount" *ngIf="amount > 0">
          Сумма: <strong>{{ amount | number:'1.2-2' }} ₽</strong>
        </div>
        <div class="pm-subtitle" *ngIf="title">{{ title }}</div>

        <div class="pm-actions">
          <button class="pm-btn pm-cash" (click)="choose('cash')">
            💵 Наличные
          </button>
          <button class="pm-btn pm-card" (click)="choose('card_terminal')">
            💳 Безналичные
          </button>
        </div>
      </div>

      <div class="pm-footer">
        <button class="pm-btn pm-cancel" (click)="onCancel()">Отмена</button>
      </div>
    </div>
  `,
  styles: [`
    .pm-backdrop {
      position: fixed; inset: 0; background: rgba(15,23,42,.5);
      z-index: 1000; animation: fadeIn .15s ease;
    }
    .pm-dialog {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: #fff; border-radius: 12px; min-width: 360px; max-width: 92vw;
      z-index: 1001; box-shadow: 0 20px 60px rgba(0,0,0,.3);
      animation: slideUp .2s ease; display: flex; flex-direction: column;
    }
    .pm-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 18px; border-bottom: 1px solid #e2e8f0;
    }
    .pm-header h3 { margin: 0; font-size: 16px; color: #0f172a; }
    .pm-close {
      background: none; border: none; font-size: 18px; cursor: pointer;
      color: #94a3b8; padding: 4px 8px; border-radius: 4px;
    }
    .pm-close:hover { color: #0f172a; background: #f1f5f9; }
    .pm-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
    .pm-amount { font-size: 14px; color: #475569; }
    .pm-amount strong { color: #0f172a; font-size: 18px; }
    .pm-subtitle { font-size: 13px; color: #64748b; }
    .pm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .pm-btn {
      padding: 12px 14px; border: none; border-radius: 8px;
      font-size: 14px; cursor: pointer; font-weight: 600;
    }
    .pm-cash { background: #16a34a; color: #fff; }
    .pm-cash:hover { background: #15803d; }
    .pm-card { background: #2563eb; color: #fff; }
    .pm-card:hover { background: #1d4ed8; }
    .pm-footer {
      padding: 12px 18px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end;
    }
    .pm-cancel { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
    .pm-cancel:hover { background: #e2e8f0; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp {
      from { transform: translate(-50%, -45%); opacity: 0; }
      to   { transform: translate(-50%, -50%); opacity: 1; }
    }
  `],
})
export class PaymentMethodDialogComponent {
  @Input() amount = 0;
  @Input() title = '';
  @Output() selected = new EventEmitter<PaymentMethod>();
  @Output() cancelled = new EventEmitter<void>();

  choose(method: PaymentMethod): void {
    this.selected.emit(method);
  }

  onCancel(): void {
    this.cancelled.emit();
  }
}