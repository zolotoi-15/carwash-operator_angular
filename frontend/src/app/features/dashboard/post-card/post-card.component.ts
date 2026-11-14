import { Component, Input, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { RealtimeService, RealtimeMessage } from '../../../core/services/realtime.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReceiptModalComponent } from '../receipt-modal/receipt-modal.component';
import {
  PaymentMethodDialogComponent,
  PaymentMethod,
} from '../../../shared/components/payment-method-dialog/payment-method-dialog.component';

interface CardScanFlash {
  card: string;
  postId: string;
  timestamp: number;
}

export interface ActiveService {
  name: string;
  price: number;
  free_time_sec: number;
}

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReceiptModalComponent,
    PaymentMethodDialogComponent,
  ],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss'],
})
export class PostCardComponent implements OnInit, OnDestroy {
  @Input() postId!: number;

  /** ★ Активные услуги, приходят из DashboardComponent */
  @Input() activeServices: ActiveService[] = [];

  private realtime = inject(RealtimeService);
  private notify = inject(NotificationService);
  private cdr = inject(ChangeDetectorRef); // Для принудительного обновления UI

  // ============================================================
  // Состояние поста
  // ============================================================
  online = false;
  esp32Connected = false;
  busy = false;
  paused = false;
  balance = 0;
  activeFunction = '';
  sum = 0;
  lastSeen: number | null = null;

  currentAdvanceReceiptNumber: number | null = null;

  // ★ Активная карта клиента
  clientCard: string | null = null;
  clientCardBalance = 0;
  postCashBalance = 0;

  // ★ Если есть карта, показываем её баланс, иначе — баланс поста
  get displayBalance(): number {
    return this.clientCard ? this.clientCardBalance : this.balance;
  }

  private transferring = false;
  private lastTransferredCard: string | null = null;

  // ============================================================
  // Пополнение
  // ============================================================
  topUpAmount: number | null = null;
  showTopUpModal = false;
  showPaymentDialog = false;
  pendingTopUpAmount = 0;

  // ============================================================
  // Flash при сканировании карты (4 сек)
  // ============================================================
  lastCardScan: CardScanFlash | null = null;
  cardFlashVisible = false;
  private flashTimeout: any = null;

  get functions(): string[] {
    return (this.activeServices || []).map(s => s.name);
  }

  private subs = new Subscription();

  ngOnInit(): void {
    this.subs.add(
      this.realtime.messages$.subscribe((msg) => {
        this.handleRealtime(msg);
        this.cdr.detectChanges(); // ★ Обновляем UI при каждом сообщении
      }),
    );
  }

  ngOnDestroy(): void {
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.subs.unsubscribe();
  }

  // ============================================================
  // WebSocket — единый поток событий
  // ============================================================
  private handleRealtime(msg: RealtimeMessage): void {
    const postIdStr = String(this.postId);

    if (msg.type === 'snapshot') {
      const state = msg.posts?.[postIdStr];
      if (state) this.applyState(state);
      return;
    }

    if (msg.type === 'card-scan' && String(msg.postId) === postIdStr) {
      if (msg.error) {
        this.notify.error(msg.error);
        this.clientCard = null;
        this.clientCardBalance = 0;
        return;
      }
      if (typeof (msg as any).balance === 'number') {
        this.clientCardBalance = (msg as any).balance;
      }
      if (typeof (msg as any).postCashBalance === 'number') {
        this.postCashBalance = (msg as any).postCashBalance;
      }
      this.showCardFlash(msg.card || '');
      return;
    }

    if (msg.type === 'card-balance' && String(msg.postId) === postIdStr) {
      if (msg.card) {
        if (typeof msg.balance === 'number') {
          this.clientCardBalance = msg.balance;
        }
        this.showCardFlash(String(msg.card));
      } else if (typeof msg.balance === 'number') {
        this.balance = msg.balance;
      }
      return;
    }

    if (msg.type !== 'mqtt') return;

    const topic = msg.topic || '';

    if (topic === `posts/${postIdStr}/lwt`) {
      const online = (msg.payload || '').trim().toLowerCase() === 'online';
      this.online = online;
      this.esp32Connected = online;
      return;
    }

    if (topic === `posts/${postIdStr}/status`) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        this.applyState(data);
      } catch { /* ignore */ }
      return;
    }

    if (topic === `posts/${postIdStr}/status_relay`) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (typeof data.busy === 'boolean') this.busy = data.busy;
        if (typeof data.paused === 'boolean') this.paused = data.paused;
        if (typeof data.currentProgram === 'string') {
          const raw = data.currentProgram.trim();
          this.activeFunction = raw === '-' ? '' : raw;
        }
        this.maybeClearInactiveCard();
      } catch { /* ignore */ }
      return;
    }

    if (topic === `posts/${postIdStr}/clientcardbalance`) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (typeof data.balance === 'number') {
          this.clientCardBalance = data.balance;
        }
        // Не вызываем showCardFlash, чтобы UI не мигал каждую секунду
      } catch { /* ignore */ }
      return;
    }

    if (topic === `posts/${postIdStr}/receipt_number`) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (data.receiptNumber !== undefined) {
          this.currentAdvanceReceiptNumber = data.receiptNumber
            ? Number(data.receiptNumber)
            : null;
        }
        if (typeof data.balanceAfter === 'number') {
          this.balance = data.balanceAfter;
        }
      } catch { /* ignore */ }
      return;
    }
  }

  private applyState(d: any): void {
    if (typeof d.online === 'boolean') {
      this.online = d.online;
      this.esp32Connected = d.online;
    }
    if (typeof d.busy === 'boolean') this.busy = d.busy;
    if (typeof d.paused === 'boolean') this.paused = d.paused;
    if (typeof d.balance === 'number') this.balance = d.balance;
    if (typeof d.sum === 'number') this.sum = d.sum;
    else if (typeof d.total === 'number') this.sum = d.total;

    const raw = String(d.currentProgram ?? d.activeFunction ?? '').trim();
    this.activeFunction = raw === '-' ? '' : raw;

    if (typeof d.lastSeen === 'number') this.lastSeen = d.lastSeen;

    // ★ ИСПРАВЛЕНИЕ: Читаем карту и её баланс из снапшота
    if (d.clientCard !== undefined) {
      this.clientCard = d.clientCard;
    }
    if (typeof d.clientCardBalance === 'number') {
      this.clientCardBalance = d.clientCardBalance;
    } else if (d.clientCardBalance === null) {
      this.clientCardBalance = 0;
    }

    if (typeof d.postCashBalance === 'number') {
      this.postCashBalance = d.postCashBalance;
    }

    if (this.busy === false && this.balance <= 0) {
      this.currentAdvanceReceiptNumber = null;
    }

    // ★ ИСПРАВЛЕНИЕ: Убран вызов this.maybeClearInactiveCard();
    // чтобы карта не стиралась сразу после обновления страницы.
  }

  private maybeClearInactiveCard(): void {
    if (this.cardFlashVisible) return;
    if (this.busy) return;
    if (this.balance > 0) return;
    if (this.clientCardBalance > 0) return; // ★ Не стираем карту, если на ней есть деньги

    this.clientCard = null;
    this.clientCardBalance = 0;
    this.postCashBalance = 0;
    this.lastCardScan = null;
    this.lastTransferredCard = null;
  }

  // ============================================================
  // Flash при сканировании карты
  // ============================================================
  private showCardFlash(card: string): void {
    if (!card) return;

    this.handleCardActivated(card);

    this.lastCardScan = {
      card,
      postId: String(this.postId),
      timestamp: Date.now(),
    };
    this.cardFlashVisible = true;

    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => {
      this.cardFlashVisible = false;
      this.maybeClearInactiveCard();
      this.cdr.detectChanges();
    }, 4000);
  }

  private handleCardActivated(card: string): void {
    if (!card) return;

    const isNewCard = this.clientCard !== card;
    if (isNewCard) {
      this.lastTransferredCard = null;
    }
    this.clientCard = card;

    if (this.lastTransferredCard === card) {
      return;
    }

    const cashToTransfer = this.postCashBalance > 0 ? this.postCashBalance : this.balance;

    if (cashToTransfer > 0 && !this.transferring) {
      this.transferPostBalanceToCard(card, cashToTransfer);
    }
  }

  private transferPostBalanceToCard(card: string, amount: number): void {
    if (amount <= 0) return;

    this.transferring = true;
    const token = localStorage.getItem('carwash_auth_token') || '';
    const postId = this.postId;

    fetch(`/api/posts/${postId}/transfer-to-card`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ card, amount }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: any) => {
        this.balance = typeof data?.postBalance === 'number' ? data.postBalance : 0;
        this.postCashBalance = 0;
        this.lastTransferredCard = card;

        if (typeof data?.cardBalance === 'number') {
          this.clientCardBalance = data.cardBalance;
        }
        if (typeof data?.receiptNumber === 'number') {
          this.currentAdvanceReceiptNumber = data.receiptNumber;
        }

        const cardBalance = typeof data?.cardBalance === 'number'
          ? `, баланс карты: ${data.cardBalance.toFixed(2)} ₽`
          : '';
        this.notify.success(`Пост ${postId}: ${amount.toFixed(2)} ₽ переведено на карту ${card}${cardBalance}`);
      })
      .catch((err) => {
        this.notify.error(`Не удалось перевести ${amount.toFixed(2)} ₽ с поста на карту ${card}: ${err.message}`);
      })
      .finally(() => {
        this.transferring = false;
        this.cdr.detectChanges();
      });
  }

  // ============================================================
  // Команды
  // ============================================================
  printReceipt(): void { this.sendCommand('print_receipt'); }
  stop(): void { this.sendCommand('stop'); }
  pause(): void { this.sendCommand('pause'); }
  reset(): void { this.sendCommand('reset'); }

  activateFunction(programName: string): void {
    this.sendCommand(`program ${programName}`);
    this.activeFunction = programName;
  }

  openTopUpModal(): void { this.showTopUpModal = true; }
  closeTopUpModal(): void { this.showTopUpModal = false; }

  quickTopUp(): void {
    const amount = Number(this.topUpAmount) || 0;
    if (amount <= 0) return;
    this.pendingTopUpAmount = amount;
    this.showPaymentDialog = true;
  }

  handleTopUp({ postId, amount }: { postId: number; amount: number }): void {
    if (amount <= 0) return;
    this.pendingTopUpAmount = amount;
    this.showPaymentDialog = true;
  }

  onPaymentSelected(method: PaymentMethod): void {
    this.showPaymentDialog = false;
    const amount = this.pendingTopUpAmount;
    this.pendingTopUpAmount = 0;
    this.performTopUp(this.postId, amount, method);
    this.topUpAmount = null;
  }

  onPaymentCancelled(): void {
    this.showPaymentDialog = false;
    this.pendingTopUpAmount = 0;
  }

  private performTopUp(postId: number, amount: number, paymentMethod: PaymentMethod): void {
    if (amount <= 0) return;
    const token = localStorage.getItem('carwash_auth_token') || '';
    fetch(`/api/posts/${postId}/topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ amount, paymentMethod }),
    })
    .then(async (res) => {
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      return res.json();
    })
    .then((data) => {
      if (typeof data.balance === 'number') this.balance = data.balance;
      if (typeof data.receiptNumber === 'number') this.currentAdvanceReceiptNumber = data.receiptNumber;
      const label = paymentMethod === 'cash' ? 'нал.' : 'безнал.';
      const receipt = data.receiptNumber ? `, авансовый чек №${data.receiptNumber}` : '';
      this.notify.success(`Пост ${postId}: аванс +${amount} ₽ (${label})${receipt}`);
      this.cdr.detectChanges();
    })
    .catch((err) => {
      this.notify.error(`Пополнение не выполнено: ${err.message}`);
    });
  }

  private sendCommand(command: string): void {
    const token = localStorage.getItem('carwash_auth_token') || '';
    fetch(`/api/posts/${this.postId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ command }),
    })
    .then(async (res) => {
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
    })
    .catch((err) => {
      this.notify.error(`Команда не выполнена: ${err.message}`);
    });
  }
}