import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { MqttService, CardScanEvent } from '../../../core/services/mqtt.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss']
})
export class PostCardComponent implements OnInit, OnDestroy {
  @Input() postId!: number;

  private mqtt = inject(MqttService);
  private notify = inject(NotificationService);

  online = false;
  esp32Connected = false;
  busy = false;
  balance = 0;
  activeFunction = '';
  sum = 0;

  lastCardScan: CardScanEvent | null = null;
  cardFlashVisible = false;
  private flashTimeout: any = null;

  readonly functions = [
    'Вода', 'Пена', 'Воск', 'Тефлон', 'Антимошка',
    'Шампунь', 'Турбо', 'Пылесос', 'Воздух', 'Пауза'
  ];

  private subs = new Subscription();

  ngOnInit(): void {
    // LWT
    this.subs.add(
      this.mqtt.getLwtStatus().subscribe(status => {
        if (String(status.postId) === String(this.postId)) {
          this.online = status.online;
          this.esp32Connected = status.online;
        }
      })
    );

    // Статус поста
    this.subs.add(
      this.mqtt.getPostStatusUpdates().subscribe((msg: any) => {
        if (String(msg.postId) !== String(this.postId)) return;
        const d = msg.data ?? {};
        this.busy = !!(d.busy ?? d.state === 'busy');
        this.balance = Number(d.balance ?? 0);
        this.activeFunction = String(d.activeFunction ?? d.function ?? '');
        this.sum = Number(d.sum ?? d.total ?? 0);
      })
    );

    // Сканирование карты на этом посту
    this.subs.add(
      this.mqtt.getCardScanUpdates().subscribe((event: CardScanEvent) => {
        if (String(event.postId) !== String(this.postId)) return;
        this.lastCardScan = event;
        this.cardFlashVisible = true;
        if (this.flashTimeout) clearTimeout(this.flashTimeout);
        this.flashTimeout = setTimeout(() => (this.cardFlashVisible = false), 4000);
        this.notify.success(`💳 Карта ${event.card} считана на посту ${this.postId}`);
      })
    );

    // Mock (убрать после подключения MQTT)
    this.online = true;
    this.esp32Connected = true;
  }

  ngOnDestroy(): void {
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.subs.unsubscribe();
  }

  // Действия
  topUp(): void          { this.send('topup'); }
  stop(): void           { this.send('stop'); }
  pause(): void          { this.send('pause'); }
  reset(): void          { this.send('reset'); }
  printReceipt(): void   { this.send('print_receipt'); }
  activateFunction(n: string): void {
    this.send(`function:${n}`);
    this.activeFunction = n;
  }

  private send(command: string): void {
    this.mqtt.sendCommand(String(this.postId), command);
  }
}