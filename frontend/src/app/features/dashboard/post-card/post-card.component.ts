import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { MqttService, CardScanEvent } from '../../../core/services/mqtt.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReceiptModalComponent } from '../receipt-modal/receipt-modal.component';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, FormsModule, ReceiptModalComponent],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss'],
})
export class PostCardComponent implements OnInit, OnDestroy {
  @Input() postId!: number;

  private mqtt = inject(MqttService);
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
  // Пополнение — поле ввода и модалка
  // ============================================================
  topUpAmount: number | null = null;
  showTopUpModal = false;

  // ============================================================
  // Сканирование карты (flash)
  // ============================================================
  lastCardScan: CardScanEvent | null = null;
  cardFlashVisible = false;
  private flashTimeout: any = null;

  /** Названия программ — должны совпадать с тем, что присылает бэкенд */
  readonly functions = [
    'Вода',
    'Пена',
    'Воск',
    'Тефлон',
    'Антимошка',
    'Шампунь',
    'Турбо',
    'Пылесос',
    'Воздух',
    'Пауза',
  ];

  private subs = new Subscription();

  // ============================================================
  // Lifecycle
  // ============================================================
  ngOnInit(): void {
    // LWT — онлайн/оффлайн ESP32
    this.subs.add(
      this.mqtt.getLwtStatus().subscribe(status => {
        if (String(status.postId) !== String(this.postId)) return;
        this.online = status.online;
        this.esp32Connected = status.online;
      })
    );

    // Статус поста (баланс, busy, currentProgram)
    this.subs.add(
      this.mqtt.getPostStatusUpdates().subscribe((msg: any) => {
        if (String(msg.postId) !== String(this.postId)) return;
        const d = msg.data ?? {};

        this.busy = !!(d.busy ?? d.state === 'busy');
        this.paused = !!d.paused;
        this.balance = Number(d.balance ?? 0);
        this.sum = Number(d.sum ?? d.total ?? 0);

        // Бэкенд присылает currentProgram, а не activeFunction
        const raw = String(
          d.currentProgram ?? d.activeFunction ?? d.function ?? ''
        ).trim();
        this.activeFunction = raw === '-' ? '' : raw;
      })
    );

    // Сканирование карты на этом посту
    this.subs.add(
      this.mqtt.getCardScanUpdates().subscribe((event: CardScanEvent) => {
        if (String(event.postId) !== String(this.postId)) return;

        this.lastCardScan = event;
        this.cardFlashVisible = true;
        if (this.flashTimeout) clearTimeout(this.flashTimeout);
        this.flashTimeout = setTimeout(
          () => (this.cardFlashVisible = false),
          4000
        );

        this.notify.success(
          `💳 Карта ${event.card} считана на посту ${this.postId}`
        );
      })
    );
  }

  ngOnDestroy(): void {
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.subs.unsubscribe();
  }

  // ============================================================
  // Команды на пост — через MqttService
  // ============================================================
  stop(): void {
    this.send('stop');
  }

  pause(): void {
    this.send('pause');
  }

  reset(): void {
    this.send('reset');
  }

  printReceipt(): void {
    this.send('print_receipt');
  }

  /** Запуск программы. Бэкенд принимает "program <Название>" */
  activateFunction(programName: string): void {
    this.send(`program ${programName}`);
    this.activeFunction = programName;
  }

  // ============================================================
  // Пополнение баланса
  // ============================================================
  openTopUpModal(): void {
    this.showTopUpModal = true;
  }

  closeTopUpModal(): void {
    this.showTopUpModal = false;
  }

  /** Быстрое пополнение из поля рядом с «Сумма» */
  quickTopUp(): void {
    const amount = Number(this.topUpAmount) || 0;
    if (amount <= 0) return;
    this.handleTopUp({ postId: this.postId, amount });
    this.topUpAmount = null;
  }

  /** Вызывается из модалки: { postId, amount } */
  handleTopUp({ postId, amount }: { postId: number; amount: number }): void {
    if (amount <= 0) return;

    this.mqtt.sendCommand(String(postId), `add_balance ${amount}`);

    // Мгновенный отклик в UI
    this.balance = Math.round((this.balance + amount) * 100) / 100;

    this.notify.success(`Пост ${postId}: пополнено на ${amount} ₽`);
  }

  // ============================================================
  // Внутреннее
  // ============================================================
  private send(command: string): void {
    console.log(`[PostCard ${this.postId}] → ${command}`);
    this.mqtt.sendCommand(String(this.postId), command);
  }
}