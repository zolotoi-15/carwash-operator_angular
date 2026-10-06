// src/app/core/services/mqtt.service.ts
import { Injectable } from '@angular/core';
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

/** Обновление баланса карты, пришедшее из MQTT (posts/+/clientcardbalance) */
export interface CardBalanceEvent {
  postId: string;
  card: string;
  balance: number;
  type: string;
}

@Injectable({ providedIn: 'root' })
export class MqttService {
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

  /** 🔥 Поток обновлений баланса карты: { postId, card, balance, type } */
  private cardBalanceSubject = new Subject<CardBalanceEvent>();

  /** Кэш балансов постов: { "1": 145.50, "2": 0, ... } */
  private postBalances: { [postId: string]: number } = {};
  /** Пост, к которому привязан текущий оператор */
  private activePostId: string | null = null;
  /** Защита от дублирования переноса баланса */
  private lastTransferAt = 0;

  /** Поток событий сканирования карт */
  private cardScanSubject = new Subject<CardScanEvent>();

  private readonly serviceNameMap: { [key: string]: string } = {
    water: 'Вода',
    foam: 'Пена',
    wax: 'Воск',
    teflon: 'Тефлон',
    osmosis: 'Осмос',
    hotWater: 'Горячая вода',
    waterFoam: 'Вода+Пена',
    turbo: 'Турбо мойка',
  };

  constructor(
    private receiptService: ReceiptService,
    private admin: AdminService,
    private clientCardService: ClientCardService,
  ) {
    this.initMqttSettings();
  }

  private async initMqttSettings() {
    try {
      const settings = await firstValueFrom(this.admin.getSettings());
      const mqttCfg = settings.mqtt as
        | { brokerUrl?: string; username?: string; password?: string }
        | undefined;
      if (mqttCfg && mqttCfg.brokerUrl) {
        this.connect(mqttCfg.brokerUrl, mqttCfg.username, mqttCfg.password);
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

  connect(brokerUrl: string, username?: string, password?: string) {
    if (this.client) {
      this.client.end(true);
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
      this.client.subscribe('posts/+/clientcardbalance');   // 🔥 НОВОЕ
      this.client.subscribe('system/config');
      this.client.subscribe('shift/total');
      this.client.subscribe('kkm/print');
      this.client.subscribe('posts/+/lwt');
      this.client.subscribe('posts/+/local_LWT');
      this.client.subscribe('posts/config');

      // Карт-ридер
      this.client.subscribe('card-reader/scan');
      this.client.subscribe('cards/+/scan');

      localStorage.setItem(
        'mqttSettings',
        JSON.stringify({
          brokerUrl,
          username: this.username,
          password: this.password,
        }),
      );

      if (this.pendingCommands.length > 0) {
        console.log(`📤 Отправка ${this.pendingCommands.length} отложенных команд MQTT`);
        const commands = [...this.pendingCommands];
        this.pendingCommands = [];
        commands.forEach(({ postId, command }) => {
          this.sendCommand(postId, command);
        });
      }
    });

    this.client.on('message', (topic: string, message: any) => {
      const msgStr = message.toString();

      // === Сканирование карты клиента ===
      if (
        topic === 'card-reader/scan' ||
        (topic.startsWith('cards/') && topic.endsWith('/scan'))
      ) {
        this.handleCardScan(topic, msgStr);
        return;
      }

      // === LWT / local_LWT ===
      if (topic.endsWith('/lwt') || topic.endsWith('/local_LWT')) {
        const parts = topic.split('/');
        const postId = parts[1];
        const online = msgStr === 'online' || msgStr === 'true';
        this.onlineStatusMap[postId] = online;
        this.lwtStatusSubject.next({ postId, online });
        console.log(`📡 Пост ${postId}: ${online ? '🟢 онлайн' : '🔴 офлайн'}`);
        return;
      }

      // === JSON-payload'ы ===
      let payload: any;
      try {
        payload = JSON.parse(msgStr);
      } catch (e) {
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
            if (!isNaN(numeric)) {
              this.postBalances[postId] = numeric;
            }
          }
          this.postStatusSubject.next({ postId, data: payload });
        } else if (subtopic === 'clientcardbalance') {
          // 🔥 НОВОЕ: бэкенд публикует сюда баланс считанной карты
          const card = String(payload.card || '').toUpperCase();
          const balance = Number(payload.balance);
          const type = String(payload.type || 'client');

          if (card && !isNaN(balance)) {
            this.cardBalanceSubject.next({ postId, card, balance, type });
            console.log(
              `💳 [${postId}] clientcardbalance → ${card}: ${balance.toFixed(2)} ₽`,
            );
          } else {
            console.warn('⚠️ clientcardbalance: некорректный payload', payload);
          }
        }
      } else if (topic === 'system/config') {
        this.systemConfigSubject.next(payload);
      } else if (topic === 'shift/total') {
        this.shiftTotalSubject.next(payload);
      } else if (topic === 'kkm/print') {
        if (payload.items && payload.items.length > 0 && payload.totalCash > 0.01) {
          payload.items.forEach((item: any) => {
            if (item.name && this.serviceNameMap[item.name]) {
              item.name = this.serviceNameMap[item.name];
            }
            item.cost =
              item.cost != null ? Math.round(Number(item.cost) * 100) / 100 : 0;
            item.pricePerSecond =
              item.pricePerSecond != null
                ? Math.round(Number(item.pricePerSecond) * 100) / 100
                : 0;
            item.seconds =
              item.seconds != null ? Math.round(Number(item.seconds) * 100) / 100 : 0;
          });
          payload.totalCash = Math.round(Number(payload.totalCash) * 100) / 100;

          if (!payload.paymentType) {
            payload.paymentType = 'cash';
          }
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
            .map(
              (item: any) =>
                `${item.name}, ${item.seconds.toFixed(1)} сек, сумма ${item.cost.toFixed(2)} ₽`,
            )
            .join('; ');
          const payInfo =
            payload.paymentType === 'client_card'
              ? `, оплата: карта клиента ${payload.clientCardNumber}`
              : `, оплата: ${payload.paymentType}`;
          console.log(
            `📥 Чек получен из MQTT: пост ${payload.postId}, ${itemsStr}${payInfo}`,
          );
        } else {
          console.warn('⚠️ Пропущен пустой чек из MQTT');
        }
      } else if (topic === 'posts/config') {
        this.systemConfigSubject.next(payload);
      }
    });

    this.client.on('error', (err: any) => {
      console.error('MQTT error:', err);
    });

    this.client.on('close', () => {
      console.warn('MQTT connection closed, reconnecting...');
    });
  }

  // ==== Карт-ридер и перенос баланса ====

  private async handleCardScan(topic: string, msgStr: string): Promise<void> {
    let cardNumber = '';
    let postId: string | undefined;

    try {
      const payload = JSON.parse(msgStr);
      cardNumber = String(
        payload.card || payload.number || payload.uid || payload.code || '',
      ).trim();
      if (payload.postId != null) postId = String(payload.postId);
    } catch {
      cardNumber = msgStr.trim();
    }

    if (!cardNumber) {
      console.warn('⚠️ Пустое событие сканирования карты');
      return;
    }
    cardNumber = cardNumber.toUpperCase();

    if (!postId) {
      postId = this.activePostId ?? Object.keys(this.postBalances)[0];
    }

    const balance = postId != null ? this.postBalances[postId] ?? 0 : 0;

    const now = Date.now();
    const canTransfer = balance > 0 && now - this.lastTransferAt > 2000;

    const event: CardScanEvent = {
      card: cardNumber,
      source: 'reader',
      timestamp: now,
      postId,
    };

    if (canTransfer) {
      this.lastTransferAt = now;
      try {
        console.log(
          `💳 Карта ${cardNumber} считана на посту ${postId}, ` +
            `баланс терминала ${balance.toFixed(2)} ₽ — переносим на карту`,
        );

        const result = await firstValueFrom(
          this.clientCardService.topUpFromPost(cardNumber, postId!, balance),
        );

        this.postBalances[postId!] = 0;
        this.sendCommand(postId!, 'reset_balance');

        event.topUpAmount = balance;
        event.topUpStatus = 'ok';
        event.topUpResult = result;
        console.log(
          `✅ Баланс ${balance.toFixed(2)} ₽ перенесён с поста ${postId} на карту ${cardNumber}`,
        );
      } catch (err) {
        console.error(
          `❌ Ошибка переноса баланса с поста ${postId} на карту ${cardNumber}`,
          err,
        );
        event.topUpAmount = balance;
        event.topUpStatus = 'error';
      }
    } else if (balance > 0) {
      event.topUpAmount = balance;
      event.topUpStatus = 'skipped';
    }

    this.cardScanSubject.next(event);
  }

  reconnect(brokerUrl: string, username?: string, password?: string) {
    this.connect(brokerUrl, username, password);
  }

  /** 🔥 Переподключение из объекта настроек (для general-settings.component). */
  reconnectFromSettings(
    settings?: { brokerUrl?: string; username?: string; password?: string } | null,
  ): void {
    if (!settings || !settings.brokerUrl) {
      console.warn('reconnectFromSettings: пустые настройки, пропускаем');
      return;
    }
    this.connect(settings.brokerUrl, settings.username, settings.password);
  }

  sendCommand(postId: string, command: string) {
    if (this.client && this.client.connected) {
      const message = JSON.stringify({ command });
      this.client.publish(`posts/${postId}/command`, message);
    } else {
      console.warn(
        `MQTT не подключён, команда "${command}" добавлена в очередь для поста ${postId}`,
      );
      this.pendingCommands.push({ postId, command });
    }
  }

  printReceipt(receiptData: ReceiptData) {
    if (this.client && this.client.connected) {
      this.client.publish('kkm/print', JSON.stringify(receiptData));
    } else {
      console.warn('MQTT не подключён, чек добавлен в очередь (не реализовано)');
    }
  }

  publishRelayStatus(postId: string, status: any) {
    if (this.client && this.client.connected) {
      this.client.publish(`posts/${postId}/status_relay`, JSON.stringify(status));
    }
  }

  publishConfig(services: ServiceConfig[]) {
    if (!this.client || !this.client.connected) {
      console.warn('MQTT не подключён, публикация конфига отложена');
      return;
    }
    const config = { services };
    this.admin.getSettings().subscribe((settings) => {
      const count = settings.numberOfPosts || 8;
      for (let i = 1; i <= count; i++) {
        const topic = `posts/${i}/config`;
        this.client.publish(topic, JSON.stringify(config), { retain: true, qos: 1 });
      }
      console.log(`📤 Конфиг опубликован в posts/*/config (${count} постов)`);
    });
  }

  // ==== Публичные observable'ы ====

  getPostStatusUpdates() {
    return this.postStatusSubject.asObservable();
  }
  getSystemConfigUpdates() {
    return this.systemConfigSubject.asObservable();
  }
  getShiftTotalUpdates() {
    return this.shiftTotalSubject.asObservable();
  }
  getLwtStatus() {
    return this.lwtStatusSubject.asObservable();
  }
  getCardScanUpdates() {
    return this.cardScanSubject.asObservable();
  }

  /** 🔥 Поток обновлений баланса карты из MQTT. */
  getCardBalanceUpdates() {
    return this.cardBalanceSubject.asObservable();
  }

  isOnline(postId: string): boolean {
    return this.onlineStatusMap[postId] || false;
  }

  isConnected(): boolean {
    return this.client?.connected || false;
  }

  // ==== Карт-ридер: управление ====

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
      timestamp: Date.now(),
    });
  }



  // ==== Активный пост и балансы ====

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