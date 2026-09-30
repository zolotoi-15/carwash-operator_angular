// src/app/pages/dashboard/post-card.component.ts
import { Component, Input, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription, interval } from 'rxjs';
import { MqttService } from '../../services/mqtt.service';
import { AdminService, AppSettings } from '../../services/admin.service';
import { LocalPostService, PostState } from '../../services/local-post.service';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PostCardComponent implements OnInit, OnDestroy {
  @Input() postId!: string;
  @Input() isAdmin: boolean = false;
  @Input() cameraUrl: string = '';

  post: PostState = {
    busy: false,
    paused: false,
    balance: 0,
    currentProgram: '-',
    elapsedSec: 0,
    totalPaid: 0,
    receiptCount: 0,
    timer: null,
    servicesUsage: {},
    receiptSent: false,
    pricePerSecond: 0  // добавлено
  };

  isEspOnline: boolean = false;
  addAmount: number | null = null;
  safeCameraUrl: SafeResourceUrl | null = null;
  showCamera: boolean = false;
  private subs: Subscription = new Subscription();
  private currentSettings: AppSettings | null = null;

  programs: { code: string; name: string }[] = [];

  constructor(
    private mqtt: MqttService,
    private admin: AdminService,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    private localPost: LocalPostService
  ) { }

  ngOnInit() {
    // Подписка на локальные обновления поста
    this.subs.add(
      this.localPost.getPostsObservable().subscribe(updates => {
        const update = updates.find(u => u.postId === this.postId);
        if (update) {
          this.post = { ...update.state };
          this.cdr.markForCheck();
        }
      })
    );

    // Подписка на статусы от MQTT (ESP32)
    this.subs.add(
      this.mqtt.getPostStatusUpdates().subscribe(mqttUpdate => {
        if (mqttUpdate.postId === this.postId) {
          this.localPost.syncFromMqtt(this.postId, mqttUpdate.data);
          this.cdr.markForCheck();
        }
      })
    );

    // Подписка на LWT статус
    this.subs.add(
      this.mqtt.getLwtStatus().subscribe(status => {
        if (status.postId === this.postId) {
          this.isEspOnline = status.online;
          this.cdr.markForCheck();
          console.log(`📡 Пост ${this.postId}: ESP32 ${this.isEspOnline ? 'онлайн' : 'офлайн'}`);
        }
      })
    );

    // Периодическая проверка онлайн-статуса (каждые 5 секунд)
    this.subs.add(
      interval(5000).subscribe(() => {
        this.isEspOnline = this.mqtt.isOnline(this.postId);
        this.cdr.markForCheck();
      })
    );

    // Проверка текущего статуса
    this.isEspOnline = this.mqtt.isOnline(this.postId);

    // Загружаем начальное состояние
    const initial = this.localPost.getPostState(this.postId);
    this.post = { ...initial };

    // Получаем настройки
    this.admin.getSettings().subscribe(settings => {
      this.currentSettings = settings;
    });

    // Подписка на динамический список услуг
    this.subs.add(
      this.localPost.getServicesObservable().subscribe(services => {
        this.programs = services.map(s => ({ code: s.name, name: s.name }));
        this.cdr.markForCheck();
      })
    );

    // Запрашиваем текущий статус у ESP32
    this.mqtt.sendCommand(this.postId, 'get_status');
    this.updateSafeUrl();
  }

  // ----- Управление постом -----
  selectProgram(program: string) {
    const isConnected = this.mqtt.isConnected();
    if (isConnected && this.isEspOnline) {
      this.mqtt.sendCommand(this.postId, `program ${program}`);
      console.log(`📤 Команда program ${program} отправлена через MQTT на пост ${this.postId}`);
    } else {
      this.localPost.startProgram(this.postId, program);
      console.log(`💻 Пост ${this.postId}: программа ${program} запущена локально`);
    }
  }

  addBalance() {
    if (!this.addAmount || this.addAmount <= 0) {
      alert('Введите сумму больше 0');
      return;
    }

    const isConnected = this.mqtt.isConnected();
    if (isConnected && this.isEspOnline) {
      this.mqtt.sendCommand(this.postId, `add_balance ${this.addAmount}`);
      console.log(`📤 Команда add_balance отправлена через MQTT на пост ${this.postId}`);
    } else {
      this.localPost.addBalance(this.postId, this.addAmount);
      console.log(`💵 Баланс поста ${this.postId} пополнен локально на ${this.addAmount} ₽`);
    }

    this.addAmount = null;
  }

  stopPost() {
    const isConnected = this.mqtt.isConnected();
    if (isConnected && this.isEspOnline) {
      this.mqtt.sendCommand(this.postId, 'stop');
      console.log(`📤 Команда stop отправлена через MQTT на пост ${this.postId}`);
    } else {
      this.localPost.stopProgram(this.postId, true);
      console.log(`💻 Пост ${this.postId} остановлен локально`);
    }
  }

  pausePost() {
    const isConnected = this.mqtt.isConnected();
    if (isConnected && this.isEspOnline) {
      this.mqtt.sendCommand(this.postId, 'pause');
      console.log(`📤 Команда pause отправлена через MQTT на пост ${this.postId}`);
    } else {
      this.localPost.togglePause(this.postId);
      console.log(`💻 Пост ${this.postId}: пауза переключена локально`);
    }
  }

  resetPost() {
    const isConnected = this.mqtt.isConnected();
    if (isConnected && this.isEspOnline) {
      this.mqtt.sendCommand(this.postId, 'reset');
      console.log(`📤 Команда reset отправлена через MQTT на пост ${this.postId}`);
    } else {
      this.localPost.resetPost(this.postId);
      console.log(`💻 Пост ${this.postId} сброшен локально`);
    }
  }

  printReceipt() {
    const isConnected = this.mqtt.isConnected();
    if (isConnected && this.isEspOnline) {
      this.mqtt.sendCommand(this.postId, 'print_receipt');
      console.log(`📤 Команда print_receipt отправлена через MQTT на пост ${this.postId}`);
    } else {
      this.localPost.printReceipt(this.postId);
      console.log(`🧾 Чек для поста ${this.postId} напечатан локально`);
    }
  }

  // ----- Методы для камеры -----
  isVideoUrl(url: string): boolean {
    if (!url) return false;
    return /\.(mp4|webm|ogg|m3u8)(\?.*)?$/i.test(url);
  }

  toggleCamera() {
    this.showCamera = !this.showCamera;
    if (this.showCamera) this.updateSafeUrl();
  }

  updateSafeUrl() {
    if (this.cameraUrl && this.cameraUrl.startsWith('http')) {
      this.safeCameraUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.cameraUrl);
    } else {
      this.safeCameraUrl = null;
    }
  }

  clearAddAmount() {
    this.addAmount = null;
  }

  // ----- Вспомогательные методы -----
  formatTime(sec: number): string {
    if (!sec && sec !== 0) return '0:00';
    const roundedSec = Math.round(sec * 10) / 10;
    const m = Math.floor(roundedSec / 60);
    const s = Math.floor(roundedSec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  getProgramName(programCode: string): string {
    const prog = this.programs.find(p => p.code === programCode);
    return prog ? prog.name : (programCode || '-');
  }

  roundOne(value: number): number {
    return Math.round(value * 10) / 10;
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    const state = this.localPost.getPostState(this.postId);
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }
}
