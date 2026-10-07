import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { RealtimeService, RealtimeMessage } from '../../../core/services/realtime.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReceiptModalComponent } from '../receipt-modal/receipt-modal.component';

interface CardScanFlash {
  card: string;
  postId: string;
  timestamp: number;
}

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, FormsModule, ReceiptModalComponent],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss'],
})
export class PostCardComponent implements OnInit, OnDestroy {
  @Input() postId!: number;

  private realtime = inject(RealtimeService);
  private notify = inject(NotificationService);

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

  // ============================================================
  // Пополнение
  // ============================================================
  topUpAmount: number | null = null;
  showTopUpModal = false;

  // ============================================================
  // Flash при сканировании карты — ИСПОЛЬЗУЕТСЯ В HTML
  // ============================================================
  lastCardScan: CardScanFlash | null = null;
  cardFlashVisible = false;
  private flashTimeout: any = null;

  readonly functions = [
    'Вода', 'Пена', 'Воск', 'Тефлон', 'Антимошка',
    'Шампунь', 'Турбо', 'Пылесос', 'Воздух', 'Пауза',
  ];

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
  // WebSocket
  // ============================================================
  private handleRealtime(msg: RealtimeMessage): void {
    // Снимок состояния при подключении
    if (msg.type === 'snapshot') {
      const state = msg.posts?.[String(this.postId)];
      if (state) this.applyState(state);
      return;
    }

    // Событие сканирования карты — flash
    if (msg.type === 'card-scan' && String(msg.postId) === String(this.postId)) {
      this.showCardFlash(msg.card || '');
      return;
    }

    if (msg.type !== 'mqtt') return;
    const topic = msg.topic || '';
    const postIdStr = String(this.postId);

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

    if (topic === `posts/${postIdStr}/clientcardbalance`) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (typeof data.balance === 'number') this.balance = data.balance;
        if (data.card) this.showCardFlash(String(data.card));
      } catch { /* ignore */ }
      return;
    }
  }

  private applyState(d: any): void {
    // 🔥 Читаем online из snapshot
    if (typeof d.online === 'boolean') {
        this.online = d.online;
        this.esp32Connected = d.online;
    }

    this.busy = !!(d.busy ?? d.state === 'busy');
    this.paused = !!d.paused;
    this.balance = Number(d.balance ?? 0);
    this.sum = Number(d.sum ?? d.total ?? 0);
    const raw = String(d.currentProgram ?? d.activeFunction ?? '').trim();
    this.activeFunction = raw === '-' ? '' : raw;
}

  /** 🔙 Восстановлено: показать flash-плашку с номером карты */
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
    }, 4000);
  }

  // ============================================================
  // Команды — через REST (backend сам публикует в MQTT)
  // ============================================================
  stop(): void { this.sendCommand('stop'); }
  pause(): void { this.sendCommand('pause'); }
  reset(): void { this.sendCommand('reset'); }
  printReceipt(): void { this.sendCommand('print_receipt'); }

  activateFunction(programName: string): void {
    this.sendCommand(`program ${programName}`);
    this.activeFunction = programName;
  }

  openTopUpModal(): void { this.showTopUpModal = true; }
  closeTopUpModal(): void { this.showTopUpModal = false; }

  quickTopUp(): void {
    const amount = Number(this.topUpAmount) || 0;
    if (amount <= 0) return;
    this.handleTopUp({ postId: this.postId, amount });
    this.topUpAmount = null;
  }

  handleTopUp({ postId, amount }: { postId: number; amount: number }): void {
    if (amount <= 0) return;
    this.sendCommand(`add_balance ${amount}`);
    this.balance = Math.round((this.balance + amount) * 100) / 100;
    this.notify.success(`Пост ${postId}: пополнено на ${amount} ₽`);
  }

  private sendCommand(command: string): void {
    const token = localStorage.getItem('carwash_auth_token') || '';
    console.log(`[PostCard ${this.postId}] → ${command}`);

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
        console.log(`[PostCard ${this.postId}] ✅ ${command}`);
      })
      .catch((err) => {
        console.error(`[PostCard ${this.postId}] ❌ ${command}:`, err.message);
        this.notify.error(`Команда не выполнена: ${err.message}`);
      });
  }
}