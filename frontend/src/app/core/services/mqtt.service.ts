// src/app/core/services/mqtt.service.ts
import { Injectable, inject } from '@angular/core';
import mqtt from 'mqtt';
import { Subject, firstValueFrom } from 'rxjs';
import { ReceiptData } from '../models/receipt.model';
import { ReceiptService } from './receipt.service';
import { AdminService } from './admin.service';
import { ClientCardService } from './client-card.service';

export interface ServiceConfig {
  name: string;
  price: number;
  free_time_sec?: number;
}

/** Событие сканирования карты клиента */
export interface CardScanEvent {
  card: string;
  source?: 'reader' | 'manual';
  timestamp?: number;
  postId?: string;
  topUpAmount?: number;
  topUpStatus?: 'ok' | 'skipped' | 'error';
  topUpResult?: any;
}

@Injectable({ providedIn: 'root' })
export class MqttService {
  private receiptService = inject(ReceiptService);
  private admin = inject(AdminService);
  private clientCardService = inject(ClientCardService);

  private client: any;
  private brokerUrl = '';
  private username = '';
  private password = '';
  private reconnectTimeout: any = null;
  private pendingCommands: { postId: string; command: string }[] = [];

  private postStatusSubject = new Subject<any>();
  private systemConfigSubject = new Subject<any>();
  private shiftTotalSubject = new Subject<any>();
  private lwtStatusSubject = new Subject<{ postId: string; online: boolean }>();
  private onlineStatusMap: { [postId: string]: boolean } = {};

  /** Кэш балансов постов: { "1": 145.50, "2": 0, ... } */
  private postBalances: { [postId: string]: number } = {};
  /** Пост, к которому привязан текущий оператор */
  private activePostId: string | null = null;

  /** Поток событий сканирования карт */
  private cardScanSubject = new Subject<CardScanEvent>();

  private readonly serviceNameMap: { [key: string]: string } = {
    'water': 'Вода',
    'foam': 'Пена',
    'wax': 'Воск',
    'teflon': 'Тефлон',
    'osmosis': 'Осмос',
    'hotWater': 'Горячая вода',
    'waterFoam': 'Вода+Пена',
    'turbo': 'Турбо мойка'
  };

  constructor() {
    this.initMqttSettings();
  }

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================

  private async initMqttSettings(): Promise<void> {
    try {
      const settings = await firstValueFrom(this.admin.getSettings());
      if (settings.mqtt?.brokerUrl) {
        this.connect(
          settings.mqtt.brokerUrl,
          settings.mqtt.username,
          settings.mqtt.password
        );
        return;
      }
    } catch (e) {
      console.warn('Не удалось загрузить настройки MQTT с бэкенда', e);
    }

    const saved = localStorage.getItem('mqttSettings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.brokerUrl) {
          this.connect(settings.brokerUrl, settings.username, settings.password);
          return;
        }
      } catch (e) {
        console.warn('Ошибка парсинга сохранённых MQTT-настроек', e);
      }
    }

    const defaultUrl = `ws://${window.location.hostname}:8083`;
    console.warn('Используем настройки MQTT по умолчанию:', defaultUrl);
    this.connect(defaultUrl);
  }

  connect(brokerUrl: string, username?: string, password?: string): void {
    if (this.client) {
      try { this.client.end(true); } catch { /* ignore */ }
      this.client = null;
    }

    this.brokerUrl = brokerUrl;
    this.username = username || '';
    this.password = password || '';

    const options: any = {};
    if (this.username) options.username = this.username;
    if (this.password) options.password = this.password;

    this.client = mqtt.connect(brokerUrl, options);

    this.client.on('connect', () => {
      console.log('MQTT connected to', brokerUrl);

      this.client.subscribe('posts/+/status');
      this.client.subscribe('system/config');
      this.client.subscribe('shift/total');
      this.client.subscribe('kkm/print');
      this.client.subscribe('posts/+/lwt');
      this.client.subscribe('posts/+/local_LWT');
      this.client.subscribe('posts/config');
      this.client.subscribe('card-reader/scan');
      this.client.subscribe('cards/+/scan');

      localStorage.setItem('mqttSettings', JSON.stringify({
        brokerUrl,
        username: this.username,
        password: this.password
      }));

      if (this.pendingCommands.length > 0) {
        console.log(`📤 Отправка ${this.pendingCommands.length} отложенных команд MQTT`);
        const commands = [...this.pendingCommands];
        this.pendingCommands = [];
        commands.forEach(({ postId, command }) => this.sendCommand(postId, command));
      }
    });

    this.client.on('message', (topic: string, message: any) => {
      this.handleMessage(topic, message.toString());
    });

    this.client.on('error', (err: any) => {
      console.error('MQTT error:', err);
    });

    this.client.on('close', () => {
      console.warn('MQTT connection closed, reconnecting...');
    });
  }

  // ==================== ОБРАБОТКА СООБЩЕНИЙ ====================

  private handleMessage(topic: string, msgStr: string): void {
    // === Карт-ридер ===
    if (
      topic === 'card-reader/scan' ||
      (topic.startsWith('cards/') && topic.endsWith('/scan'))
    ) {
      void this.handleCardScan(topic, msgStr);
      return;
    }

    // === LWT ===
    if (topic.endsWith('/lwt') || topic.endsWith('/local_LWT')) {
      const parts = topic.split('/');
      const postId = parts[1];
      const online = msgStr === 'online' || msgStr === 'true';
      this.onlineStatusMap[postId] = online;
      this.lwtStatusSubject.next({ postId, online });
      console.log(`📡 Пост ${postId}: ${online ? '🟢 онлайн' : '🔴 офлайн'}`);
      return;
    }

    // === JSON ===
    let payload: any;
    try {
      payload = JSON.parse(msgStr);
    } catch {
      return;
    }

    if (topic.startsWith('posts/')) {
      const parts = topic.split('/');
      const postId = parts[1];
      const subtopic = parts[2];

      if (subtopic === 'status') {
        const rawBalance =
          payload.balance ??
          payload.cash ??
          payload.totalCash ??
          payload.terminalBalance;

        if (rawBalance != null) {
          const numeric = Math.round(Number(rawBalance) * 100) / 100;
          if (!isNaN(numeric)) this.postBalances[postId] = numeric;
        }
        this.postStatusSubject.next({ postId, data: payload });
      }
      return;
    }

    if (topic === 'system/config') {
      this.systemConfigSubject.next(payload);
      return;
    }

    if (topic === 'shift/total') {
      this.shiftTotalSubject.next(payload);
      return;
    }

    if (topic === 'kkm/print') {
      this.handleReceipt(payload);
      return;
    }

    if (topic === 'posts/config') {
      this.systemConfigSubject.next(payload);
      return;
    }
  }

  private handleReceipt(payload: any): void {
    if (!payload.items || payload.items.length === 0 || payload.totalCash <= 0.01) {
      console.warn('⚠️ Пропущен пустой чек из MQTT');
      return;
    }

    payload.items.forEach((item: any) => {
      if (item.name && this.serviceNameMap[item.name]) {
        item.name = this.serviceNameMap[item.name];
      }
      item.cost = item.cost != null ? Math.round(Number(item.cost) * 100) / 100 : 0;
      item.pricePerSecond = item.pricePerSecond != null
        ? Math.round(Number(item.pricePerSecond) * 100) / 100
        : 0;
      item.seconds = item.seconds != null
        ? Math.round(Number(item.seconds) * 100) / 100
        : 0;
    });

    payload.totalCash = Math.round(Number(payload.totalCash) * 100) / 100;

    if (!payload.paymentType) payload.paymentType = 'cash';

    if (payload.paymentType === 'client_card') {
      payload.clientCardNumber = payload.clientCardNumber
        ? String(payload.clientCardNumber).toUpperCase()
        : null;
      if (!payload.clientCardNumber) {
        console.warn('⚠️ Чек с оплатой картой клиента без номера карты');
      }
    } else {
      delete payload.clientCardNumber;
    }

    this.receiptService.addReceipt(payload);

    const itemsStr = payload.items
      .map((item: any) =>
        `${item.name}, ${item.seconds.toFixed(1)} сек, сумма ${item.cost.toFixed(2)} ₽`)
      .join('; ');
    const payInfo = payload.paymentType === 'client_card'
      ? `, оплата: карта клиента ${payload.clientCardNumber}`
      : `, оплата: ${payload.paymentType}`;
    console.log(`📥 Чек получен из MQTT: пост ${payload.postId}, ${itemsStr}${payInfo}`);
  }

  // ==================== КАРТ-РИДЕР ====================

  private async handleCardScan(topic: string, msgStr: string): Promise<void> {
    let cardNumber = '';
    let postId: string | undefined;

    try {
      const payload = JSON.parse(msgStr);
      cardNumber = String(
        payload.card || payload.number || payload.uid || payload.code || ''
      ).trim();
      if (payload.postId != null) postId = String(payload.postId);
    } catch {
      cardNumber = msgStr.trim();
    }

    if (!cardNumber || cardNumber.toUpperCase() === 'NULL') {
      console.warn('⚠️ Пустое или NULL-событие сканирования карты, пропущено');
      return;
    }
    cardNumber = cardNumber.toUpperCase();

    if (!postId) {
      postId = this.activePostId ?? Object.keys(this.postBalances)[0];
    }

    // ВАЖНО: начисление баланса карты выполняет ESP32.
    // Angular только оповещает UI о факте сканирования.
    this.cardScanSubject.next({
      card: cardNumber,
      source: 'reader',
      timestamp: Date.now(),
      postId
    });
  }

  reconnect(brokerUrl: string, username?: string, password?: string): void {
    this.connect(brokerUrl, username, password);
  }

  // ==================== ОТПРАВКА КОМАНД ====================

  sendCommand(postId: string, command: string): void {
    if (this.client && this.client.connected) {
      this.client.publish(`posts/${postId}/command`, JSON.stringify({ command }));
    } else {
      console.warn(`MQTT не подключён, команда "${command}" в очереди (пост ${postId})`);
      this.pendingCommands.push({ postId, command });
    }
  }

  printReceipt(receiptData: ReceiptData): void {
    if (this.client && this.client.connected) {
      this.client.publish('kkm/print', JSON.stringify(receiptData));
    } else {
      console.warn('MQTT не подключён, чек добавлен в очередь (не реализовано)');
    }
  }

  publishRelayStatus(postId: string, status: any): void {
    if (this.client && this.client.connected) {
      this.client.publish(`posts/${postId}/status_relay`, JSON.stringify(status));
    }
  }

  publishConfig(services: ServiceConfig[]): void {
    if (!this.client || !this.client.connected) {
      console.warn('MQTT не подключён, публикация конфига отложена');
      return;
    }

    const config = { services };
    this.admin.getSettings().subscribe(settings => {
      const count = settings.numberOfPosts || 8;
      for (let i = 1; i <= count; i++) {
        this.client.publish(`posts/${i}/config`, JSON.stringify(config), {
          retain: true,
          qos: 1
        });
      }
      console.log(`📤 Конфиг опубликован в posts/*/config (${count} постов)`);
    });
  }

  // ==================== OBSERVABLES ====================

  getPostStatusUpdates() { return this.postStatusSubject.asObservable(); }
  getSystemConfigUpdates() { return this.systemConfigSubject.asObservable(); }
  getShiftTotalUpdates() { return this.shiftTotalSubject.asObservable(); }
  getLwtStatus() { return this.lwtStatusSubject.asObservable(); }
  getCardScanUpdates() { return this.cardScanSubject.asObservable(); }

  isOnline(postId: string): boolean {
    return this.onlineStatusMap[postId] || false;
  }

  isConnected(): boolean {
    return this.client?.connected || false;
  }

  // ==================== КАРТ-РИДЕР: УПРАВЛЕНИЕ ====================

  requestCardScan(): void {
    if (!this.client || !this.client.connected) {
      console.warn('MQTT не подключён, команда сканирования карты отложена');
      return;
    }
    this.client.publish('card-reader/command', JSON.stringify({ action: 'scan' }));
  }

  emitCardScan(card: string): void {
    const normalized = String(card || '').trim().toUpperCase();
    if (!normalized) return;
    this.cardScanSubject.next({
      card: normalized,
      source: 'manual',
      timestamp: Date.now()
    });
  }

  // ==================== АКТИВНЫЙ ПОСТ И БАЛАНСЫ ====================

  setActivePost(postId: string | null): void {
    this.activePostId = postId ? String(postId) : null;
  }

  getActivePost(): string | null {
    return this.activePostId;
  }

  getPostBalance(postId: string): number {
    return this.postBalances[String(postId)] ?? 0;
  }

  getPostBalancesSnapshot(): { [postId: string]: number } {
    return { ...this.postBalances };
  }
}