import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { MqttService } from '../../../../core/services/mqtt.service';

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

  online = false;
  esp32Connected = false;
  busy = false;
  balance = 0;
  activeFunction = '';
  sum = 0;

  readonly functions = [
    'Вода', 'Пена', 'Воск', 'Тефлон', 'Антимошка',
    'Шампунь', 'Турбо', 'Пылесос', 'Воздух', 'Пауза'
  ];

  private subs = new Subscription();

  ngOnInit(): void {
    // LWT-статус (онлайн/оффлайн)
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
        this.busy = !!d.busy;
        this.balance = Number(d.balance ?? 0);
        this.activeFunction = String(d.activeFunction ?? '');
        this.sum = Number(d.sum ?? 0);
      })
    );

    // Mock (пока MQTT молчит) — убрать после подключения брокера
    this.online = true;
    this.esp32Connected = true;
    this.busy = false;
    this.balance = 0;
    this.activeFunction = '';
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ==== Действия ====
  topUp(): void {
    this.mqtt.sendCommand(String(this.postId), 'topup');
  }

  stop(): void {
    this.mqtt.sendCommand(String(this.postId), 'stop');
  }

  pause(): void {
    this.mqtt.sendCommand(String(this.postId), 'pause');
  }

  reset(): void {
    this.mqtt.sendCommand(String(this.postId), 'reset');
  }

  printReceipt(): void {
    this.mqtt.sendCommand(String(this.postId), 'print_receipt');
  }

  activateFunction(name: string): void {
    this.mqtt.sendCommand(String(this.postId), `function:${name}`);
  }
}