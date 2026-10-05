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
  private client: any;
  private brokerUrl = '';
  private username = '';
  private password = '';
  private pendingCommands: { postId: string; command: string }[] = [];

  private postStatusSubject = new Subject<any>();
  private systemConfigSubject = new Subject<any>();
  private shiftTotalSubject = new Subject<any>();
  private lwtStatusSubject = new Subject<{ postId: string; online: boolean }>();
  private cardScanSubject = new Subject<CardScanEvent>();

  private onlineStatusMap: { [postId: string]: boolean } = {};
  private postBalances: { [postId: string]: number } = {};
  private activePostId: string | null = null;

  private readonly serviceNameMap: { [key: string]: string } = {
    water: 'Вода', foam: 'Пена', wax: 'Воск', teflon: 'Тефлон',
    osmosis: 'Осмос', hotWater: 'Горячая вода', waterFoam: 'Вода+Пена', turbo: 'Турбо мойка'
  };

  private readonly receiptService = inject(ReceiptService);
  private readonly admin = inject(AdminService);
  private readonly clientCardService = inject(ClientCardService);

  constructor() {
    this.initMqttSettings();
  }

  private async initMqttSettings() {
    try {
      const settings = await firstValueFrom(this.admin.getSettings());
      if (settings.mqtt && settings.mqtt.brokerUrl) {
        this.connect(settings.mqtt.brokerUrl, settings.mqtt.username, settings.mqtt.password);
        return;
      }
    } catch (e) {
      console.warn('Не удалось загрузить настройки MQTT с бэкенда', e);
    }
    const saved = localStorage.getItem('mqttSettings');
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.brokerUrl) { this.connect(s.brokerUrl, s.username, s.password); return; }
      } catch {}
    }
    const defaultUrl = `ws://${window.location.hostname}:8083`;
    console.warn('MQTT по умолчанию:', defaultUrl);
    this.connect(defaultUrl);
  }

  connect(brokerUrl: string, username?: string, password?: string) {
    if (this.client) { this.client.end(true); this.client = null; }

    this.brokerUrl = brokerUrl;
    this.username = username || '';
    this.password = password || '';

    const options: any = {};
    if (this.username) options.username = this.username;
    if (this.password) options.password = this.password;

    this.client = mqtt.connect(brokerUrl, options);

    this.client.on('connect', () => {
      console.log('MQTT connected to', brokerUrl);

      // === ПОДПИСКИ ===
      this.client.subscribe('posts/+/status');
      this.client.subscribe('posts/+/lwt');
      this.client.subscribe('posts/+/local_LWT');
      this.client.subscribe('posts/+/config');
      this.client.subscribe('posts/+/clientcard');   // 👈 НОВОЕ — карта приложена к посту
      this.client.subscribe('system/config');
      this.client.subscribe('shift/total');
      this.client.subscribe('kkm/print');
      this.client.subscribe('card-reader/scan');
      this.client.subscribe('cards/+/scan');

      localStorage.setItem('mqttSettings', JSON.stringify({
        brokerUrl, username: this.username, password: this.password
      }));

      if (this.pendingCommands.length) {
        const cmds = [...this.pendingCommands];
        this.pendingCommands = [];
        cmds.forEach(({ postId, command }) => this.sendCommand(postId, command));
      }
    });

    this.client.on('message', (topic: string, message: any) => {
      const msgStr = message.toString();

      // === Сканирование карты клиента ===
      if (
        topic === 'card-reader/scan' ||
        (topic.startsWith('cards/') && topic.endsWith('/scan')) ||
        (topic.startsWith('posts/') && topic.endsWith('/clientcard'))   // 👈
      ) {
        this.handleCardScan(topic, msgStr);
        return;
      }

      // === LWT ===
      if (topic.endsWith('/lwt') || topic.endsWith('/local_LWT')) {
        const postId = topic.split('/')[1];
        const online = msgStr === 'online' || msgStr === 'true';
        this.onlineStatusMap[postId] = online;
        this.lwtStatusSubject.next({ postId, online });
        console.log(`📡 Пост ${postId}: ${online ? '🟢' : '🔴'}`);
        return;
      }

      // === JSON ===
      let payload: any;
      try { payload = JSON.parse(msgStr); } catch { return; }

      if (topic.startsWith('posts/')) {
        const parts = topic.split('/');
        const postId = parts[1];
        const subtopic = parts[2];

        if (subtopic === 'status') {
          const rawBalance = payload.balance ?? payload.cash ?? payload.totalCash ?? payload.terminalBalance;
          if (rawBalance != null) {
            const num = Math.round(Number(rawBalance) * 100) / 100;
            if (!isNaN(num)) this.postBalances[postId] = num;
          }
          this.postStatusSubject.next({ postId, data: payload });
        }
      } else if (topic === 'system/config') {
        this.systemConfigSubject.next(payload);
      } else if (topic === 'shift/total') {
        this.shiftTotalSubject.next(payload);
      } else if (topic === 'kkm/print') {
        if (payload.items?.length > 0 && payload.totalCash > 0.01) {
          payload.items.forEach((item: any) => {
            if (item.name && this.serviceNameMap[item.name]) item.name = this.serviceNameMap[item.name];
            item.cost = item.cost != null ? Math.round(Number(item.cost) * 100) / 100 : 0;
            item.pricePerSecond = item.pricePerSecond != null ? Math.round(Number(item.pricePerSecond) * 100) / 100 : 0;
            item.seconds = item.seconds != null ? Math.round(Number(item.seconds) * 100) / 100 : 0;
          });
          payload.totalCash = Math.round(Number(payload.totalCash) * 100) / 100;
          if (!payload.paymentType) payload.paymentType = 'cash';
          this.receiptService.addReceipt(payload);
        }
      } else if (topic === 'posts/config') {
        this.systemConfigSubject.next(payload);
      }
    });

    this.client.on('error', (err: any) => console.error('MQTT error:', err));
    this.client.on('close', () => console.warn('MQTT connection closed'));
  }

  // ==== Карт-ридер ====

  private async handleCardScan(topic: string, msgStr: string): Promise<void> {
    let cardNumber = '';
    let postId: string | undefined;

    // Извлекаем postId из топика posts/<N>/clientcard
    if (topic.startsWith('posts/')) {
      const parts = topic.split('/');
      if (parts.length >= 3) postId = parts[1];
    }

    try {
      const payload = JSON.parse(msgStr);
      cardNumber = String(payload.card || payload.number || payload.uid || payload.code || '').trim();
      if (payload.postId != null) postId = String(payload.postId);
    } catch {
      cardNumber = msgStr.trim();
    }

    if (!cardNumber || cardNumber.toUpperCase() === 'NULL') {
      console.warn('⚠️ Пустое сканирование карты');
      return;
    }
    cardNumber = cardNumber.toUpperCase();

    if (!postId) postId = this.activePostId ?? Object.keys(this.postBalances)[0];

    // Баланс поста → переносим на карту
    const balance = postId ? this.getPostBalance(postId) : 0;
    let topUpStatus: 'ok' | 'skipped' | 'error' = 'skipped';
    let topUpResult: any = null;

    if (balance > 0.01 && postId) {
      try {
        topUpResult = await firstValueFrom(
          this.clientCardService.topUpByNumber(cardNumber, { amount: balance })
        );
        topUpStatus = 'ok';
        this.postBalances[postId] = 0;
        this.sendCommand(postId, 'reset_balance');
        console.log(`✅ ${balance} ₽ перенесено на карту ${cardNumber}`);
      } catch (e) {
        topUpStatus = 'error';
        console.error('❌ Ошибка переноса баланса:', e);
      }
    }

    this.cardScanSubject.next({
      card: cardNumber,
      source: 'reader',
      timestamp: Date.now(),
      postId,
      topUpAmount: balance,
      topUpStatus,
      topUpResult
    });
  }

  reconnect(brokerUrl: string, username?: string, password?: string) {
    this.connect(brokerUrl, username, password);
  }

  sendCommand(postId: string, command: string) {
    if (this.client?.connected) {
      this.client.publish(`posts/${postId}/command`, JSON.stringify({ command }));
    } else {
      console.warn(`MQTT не подключён, команда "${command}" в очередь (пост ${postId})`);
      this.pendingCommands.push({ postId, command });
    }
  }

  printReceipt(receiptData: ReceiptData) {
    if (this.client?.connected) {
      this.client.publish('kkm/print', JSON.stringify(receiptData));
    }
  }

  publishConfig(services: ServiceConfig[]) {
    if (!this.client?.connected) {
      console.warn('MQTT не подключён');
      return;
    }
    const config = { services };
    this.admin.getSettings().subscribe(settings => {
      const count = settings.numberOfPosts || 8;
      for (let i = 1; i <= count; i++) {
        this.client.publish(`posts/${i}/config`, JSON.stringify(config), { retain: true, qos: 1 });
      }
      console.log(`📤 Конфиг отправлен в posts/*/config (${count})`);
    });
  }

  // ==== Публичные Observable ====
  getPostStatusUpdates() { return this.postStatusSubject.asObservable(); }
  getSystemConfigUpdates() { return this.systemConfigSubject.asObservable(); }
  getShiftTotalUpdates() { return this.shiftTotalSubject.asObservable(); }
  getLwtStatus() { return this.lwtStatusSubject.asObservable(); }
  getCardScanUpdates() { return this.cardScanSubject.asObservable(); }

  isOnline(postId: string): boolean { return this.onlineStatusMap[postId] || false; }
  isConnected(): boolean { return this.client?.connected || false; }

  requestCardScan(): void {
    if (!this.client?.connected) {
      console.warn('MQTT не подключён');
      return;
    }
    this.client.publish('card-reader/command', JSON.stringify({ action: 'scan' }));
  }

  emitCardScan(card: string): void {
    const n = String(card || '').trim().toUpperCase();
    if (!n) return;
    this.cardScanSubject.next({ card: n, source: 'manual', timestamp: Date.now() });
  }

  setActivePost(postId: string | null): void {
    this.activePostId = postId ? String(postId) : null;
  }

  getActivePost(): string | null { return this.activePostId; }

  getPostBalance(postId: string): number {
    return this.postBalances[String(postId)] ?? 0;
  }

  getPostBalancesSnapshot(): { [postId: string]: number } {
    return { ...this.postBalances };
  }
}