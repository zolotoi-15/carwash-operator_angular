// src/app/features/dashboard/post-card/post-card.component.ts
import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
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
  @Input() activeServices: ActiveService[] = [];

  private realtime = inject(RealtimeService);
  private notify = inject(NotificationService);

  // ============================================================
  // Состояние поста
  // ============================================================
  online = false;
  esp32Connected = false;
  busy = false;
  paused = false;
  
  /** Баланс поста (кэш аванса). При активной карте бэкенд присылает 0. */
  balance = 0;
  
  activeFunction = '';
  sum = 0;
  lastSeen: number | null = null;

  currentAdvanceReceiptNumber: number | null = null;

  // ★ Активная карта клиента
  clientCard: string | null = null;
  // ★ Баланс активной карты клиента
  clientCardBalance = 0;
  // ★ Пост-кэш: сколько денег ещё лежит на посте и ждёт перевода
  postCashBalance = 0;

  // ★ Отображение: если есть карта — показываем её баланс, иначе — баланс поста
  get displayBalance(): number {
    return this.clientCard ? this.clientCardBalance : this.balance;
  }

  // ★ Защита от двойного перевода
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
      this.realtime.messages$.subscribe((msg) => this.handleRealtime(msg)),
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

    // ★ card-scan — событие активации карты (или её удаления).
    if (msg.type === 'card-scan' && String(msg.postId) === postIdStr) {
      const card = (msg.card || '').toUpperCase();

      // ★ Если бэкенд говорит, что карты нет (card === null/пусто)
      if (!card) {
        this.clientCard = null;
        this.clientCardBalance = 0;
        this.postCashBalance = 0;
        this.balance = 0;
        this.maybeClearInactiveCard();
        return;
      }

      const isNewCard = this.clientCard !== card;
      if (isNewCard) {
        this.clientCard = card;
        this.lastTransferredCard = null;
        this.clientCardBalance = 0;
      }

      if (typeof (msg as any).balance === 'number') {
        this.clientCardBalance = (msg as any).balance;
      }
      if (typeof (msg as any).postCashBalance === 'number') {
        this.postCashBalance = (msg as any).postCashBalance;
      }

      this.showCardFlash(card);

      // ★ Перевод — только если на посту есть непереведённый аванс
      const amount = this.postCashBalance;
      if (amount > 0.01 && !this.transferring && this.lastTransferredCard !== card) {
        this.transferPostBalanceToCard(card, amount);
      }
      return;
    }

    // ★ card-balance — обновляем отображаемый баланс карты
    if (msg.type === 'card-balance' && String(msg.postId) === postIdStr) {
      if (msg.card) {
        if (this.clientCard !== msg.card) {
          this.clientCard = String(msg.card);
        }
        if (typeof msg.balance === 'number') {
          this.clientCardBalance = msg.balance;
        }
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

    // ★ clientcardbalance — обновление баланса карты
    if (topic === `posts/${postIdStr}/clientcardbalance`) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (data.card && this.clientCard !== data.card) {
          this.clientCard = String(data.card);
        }
        if (typeof data.balance === 'number') {
          this.clientCardBalance = data.balance;
        }
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
        if (typeof data.balanceAfter === 'number' && !this.clientCard) {
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

    if (typeof d.balance === 'number') {
      this.balance = d.balance;
      // ★ Если карта активна, ESP32 может присылать актуальный баланс в поле balance.
      //   Дублируем его в clientCardBalance, чтобы UI обновился во время работы услуги.
      if (this.clientCard) {
        this.clientCardBalance = d.balance;
      }
    }
    
    if (typeof d.clientCardBalance === 'number') {
      this.clientCardBalance = d.clientCardBalance;
    }
    if (typeof d.postCashBalance === 'number') {
      this.postCashBalance = d.postCashBalance;
    }

    if (typeof d.sum === 'number') this.sum = d.sum;
    else if (typeof d.total === 'number') this.sum = d.total;

    const raw = String(d.currentProgram ?? d.activeFunction ?? '').trim();
    this.activeFunction = raw === '-' ? '' : raw;

    if (typeof d.lastSeen === 'number') this.lastSeen = d.lastSeen;

    // ★ Обрабатываем как наличие карты, так и её отсутствие (null)
    if (d.clientCard === null || d.clientCard === undefined) {
      if (d.balance === 0 || !d.busy) {
        this.clientCard = null;
        this.clientCardBalance = 0;
        this.postCashBalance = 0;
      }
    } else if (typeof d.clientCard === 'string' && d.clientCard) {
      this.clientCard = d.clientCard;
    }

    if (this.busy === false && this.displayBalance <= 0) {
      this.currentAdvanceReceiptNumber = null;
    }

    this.maybeClearInactiveCard();
  }

  private maybeClearInactiveCard(): void {
    if (this.cardFlashVisible) return;
    if (this.busy) return;
    if (this.displayBalance > 0) return;

    this.clientCard = null;
    this.clientCardBalance = 0;
    this.postCashBalance = 0;
    this.lastCardScan = null;
    this.lastTransferredCard = null;
  }

  // ============================================================
  // Flash при сканировании — ТОЛЬКО визуальный
  // ============================================================
  private showCardFlash(card: string): void {
    if (!card) return;
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
    }, 4000);
  }

  // ============================================================
  // Перевод баланса поста на карту
  // ============================================================
  private transferPostBalanceToCard(card: string, amount: number): void {
    if (amount <= 0) return;
    this.transferring = true;
    const token = localStorage.getItem('carwash_auth_token') || '';
    const postId = this.postId;

    console.log(`[PostCard ${postId}] → transfer-to-card ${card}: ${amount} ₽`);

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
        this.balance = typeof data?.postBalance === 'number'
          ? data.postBalance
          : (typeof data?.balance === 'number' ? data.balance : 0);
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
        const receipt = typeof data?.receiptNumber === 'number'
          ? `, чек №${data.receiptNumber}`
          : '';
        this.notify.success(
          `Пост ${postId}: ${amount.toFixed(2)} ₽ переведено на карту ${card}${cardBalance}${receipt}`,
        );
        console.log(`[PostCard ${postId}] ✅ transfer-to-card ${card}: ${amount} ₽`);
      })
      .catch((err) => {
        console.error(
          `[PostCard ${postId}] ❌ transfer-to-card ${card}:`,
          err.message,
        );
        this.notify.error(
          `Не удалось перевести ${amount.toFixed(2)} ₽ с поста на карту ${card}: ${err.message}`,
        );
      })
      .finally(() => {
        this.transferring = false;
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
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
      if (typeof data.balance === 'number') {
        if (data.kind === 'advance_card') this.clientCardBalance = data.balance;
        else this.balance = data.balance;
      }
      if (typeof data.receiptNumber === 'number') {
        this.currentAdvanceReceiptNumber = data.receiptNumber;
      }
      const label = paymentMethod === 'cash' ? 'нал.' : 'безнал.';
      const receipt = data.receiptNumber
        ? `, авансовый чек №${data.receiptNumber}`
        : '';
      const target = data.kind === 'advance_card' ? 'Карта' : 'Пост';
      this.notify.success(
        `${target} ${postId}: аванс +${amount} ₽ (${label})${receipt}`,
      );
    })
    .catch((err) => {
      this.notify.error(`Пополнение не выполнено: ${err.message}`);
    });
  }

  private sendCommand(command: string): void {
    const token = localStorage.getItem('carwash_auth_token') || '';
    fetch(`/api/posts/${this.postId}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
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