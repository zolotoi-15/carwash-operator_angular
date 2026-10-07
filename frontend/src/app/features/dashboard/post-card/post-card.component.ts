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

  online = false;
  esp32Connected = false;
  busy = false;
  paused = false;
  balance = 0;
  activeFunction = '';
  sum = 0;

  topUpAmount: number | null = null;
  showTopUpModal = false;

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

  private handleRealtime(msg: RealtimeMessage): void {
    // 1) Снимок состояния при подключении
    if (msg.type === 'snapshot') {
      const state = msg.posts?.[String(this.postId)];
      if (state) this.applyState(state);
      return;
    }

    // 2) Одиночное MQTT-сообщение
    if (msg.type !== 'mqtt') return;
    const topic = msg.topic || '';
    const postIdStr = String(this.postId);

    // posts/<id>/lwt → online/offline
    if (topic === `posts/${postIdStr}/lwt`) {
      const online = (msg.payload || '').trim().toLowerCase() === 'online';
      this.online = online;
      this.esp32Connected = online;
      return;
    }

    // posts/<id>/status → busy, balance, currentProgram
    if (topic === `posts/${postIdStr}/status`) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        this.applyState(data);
      } catch { /* ignore */ }
      return;
    }

    // posts/<id>/clientcardbalance → баланс карты
    if (topic === `posts/${postIdStr}/clientcardbalance`) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (typeof data.balance === 'number') {
          this.balance = data.balance;
        }
      } catch { /* ignore */ }
      return;
    }
  }

  private applyState(d: any): void {
    this.busy = !!(d.busy ?? d.state === 'busy');
    this.paused = !!d.paused;
    this.balance = Number(d.balance ?? 0);
    this.sum = Number(d.sum ?? d.total ?? 0);
    const raw = String(d.currentProgram ?? d.activeFunction ?? '').trim();
    this.activeFunction = raw === '-' ? '' : raw;
  }

  // ============================================================
  // Карта-скан flash (можно вызывать и извне, если нужно)
  // ============================================================
  private showCardFlash(card: string, postId: string): void {
    this.lastCardScan = { card, postId, timestamp: Date.now() };
    this.cardFlashVisible = true;
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => (this.cardFlashVisible = false), 4000);
  }

  // ============================================================
  // Команды — через REST (backend уже умеет /api/posts/:id/command)
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

  // ============================================================
  // Отправка команды через REST (POST /api/posts/:id/command)
  // ============================================================
  private sendCommand(command: string): void {
    console.log(`[PostCard ${this.postId}] → ${command}`);
    fetch(`/api/posts/${this.postId}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('carwash_auth_token') || ''}`,
      },
      body: JSON.stringify({ command }),
    }).catch(err => console.error('sendCommand failed:', err));
  }
}