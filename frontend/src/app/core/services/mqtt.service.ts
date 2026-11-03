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

export interface CardScanEvent {
  card: string;
  source?: 'reader' | 'manual';
  timestamp?: number;
  postId?: string;
  topUpAmount?: number;
  topUpStatus?: 'ok' | 'skipped' | 'error';
  topUpResult?: any;
}

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
  private pendingCommands: { postId: string; command: string }[] = [];

  private postStatusSubject = new Subject<any>();
  private systemConfigSubject = new Subject<any>();
  private shiftTotalSubject = new Subject<any>();
  private lwtStatusSubject = new Subject<{ postId: string; online: boolean }>();
  private onlineStatusMap: { [postId: string]: boolean } = {};
  private cardBalanceSubject = new Subject<CardBalanceEvent>();

  private postBalances: { [postId: string]: number } = {};
  private activePostId: string | null = null;
  private lastTransferAt = 0;
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
    // ⚠️ MQTT ОТКЛЮЧЁН. Всё идёт через RealtimeService (WebSocket).
    // this.initMqttSettings();
    console.log('[MqttService] отключён, используется RealtimeService');
  }



  private async initMqttSettings() {
    try {
      const settings = await firstValueFrom(this.admin.getSettings());
      const mqttCfg: any = settings.mqtt;
      let url = '';
      if (mqttCfg?.brokerUrl) {
        url = mqttCfg.brokerUrl;
      } else if (mqttCfg?.local?.host) {
        const host = mqttCfg.local.host;
        const port = mqttCfg.local.portWs || 8083;
        let path = mqttCfg.local.path || '/mqtt';
        if (!path.startsWith('/')) path = '/' + path;
        url = `ws://${host}:${port}${path}`;
      }
      if (url) {
        this.connect(url, mqttCfg?.local?.username, mqttCfg?.local?.password);
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

    const defaultUrl = `ws://${window.location.hostname}:8083/mqtt`;
    console.warn('MQTT по умолчанию:', defaultUrl);
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
      this.client.subscribe('posts/+/clientcardbalance');
      this.client.subscribe('system/config');
      this.client.subscribe('shift/total');
      this.client.subscribe('kkm/print');
      this.client.subscribe('posts/+/lwt');
      this.client.subscribe('posts/+/local_LWT');
      this.client.subscribe('posts/config');
      this.client.subscribe('card-reader/scan');
      this.client.subscribe('cards/+/scan');

      localStorage.setItem('mqttSettings', JSON.stringify({
        brokerUrl, username: this.username, password: this.password,
      }));

      if (this.pendingCommands.length > 0) {
        const cmds = [...this.pendingCommands];
        this.pendingCommands = [];
        cmds.forEach(({ postId, command }) => this.sendCommand(postId, command));
      }
    });

    this.client.on('message', (topic: string, message: any) => {
      const msgStr = message.toString();

      if (topic === 'card-reader/scan' ||
          (topic.startsWith('cards/') && topic.endsWith('/scan'))) {
        this.handleCardScan(topic, msgStr);
        return;
      }

      if (topic.endsWith('/lwt') || topic.endsWith('/local_LWT')) {
        const parts = topic.split('/');
        const postId = parts[1];
        const online = msgStr === 'online' || msgStr === 'true';
        this.onlineStatusMap[postId] = online;
        this.lwtStatusSubject.next({ postId, online });
        console.log(`📡 Пост ${postId}: ${online ? '🟢 онлайн' : '🔴 офлайн'}`);
        return;
      }

      let payload: any;
      try { payload = JSON.parse(msgStr); } catch { return; }

      if (topic.startsWith('posts/')) {
        const parts = topic.split('/');
        const postId = parts[1];
        const subtopic = parts[2];

        if (subtopic === 'status') {
          const rawBalance = payload.balance ?? payload.cash ?? payload.totalCash ?? payload.terminalBalance;
          if (rawBalance != null) {
            const numeric = Math.round(Number(rawBalance) * 100) / 100;
            if (!isNaN(numeric)) this.postBalances[postId] = numeric;
          }
          this.postStatusSubject.next({ postId, data: payload });
        } else if (subtopic === 'clientcardbalance') {
          const card = String(payload.card || '').toUpperCase();
          const balance = Number(payload.balance);
          const type = String(payload.type || 'client');
          if (card && !isNaN(balance)) {
            this.cardBalanceSubject.next({ postId, card, balance, type });
            console.log(`💳 [${postId}] clientcardbalance → ${card}: ${balance.toFixed(2)} ₽`);
          }
        }
      } else if (topic === 'system/config') {
        this.systemConfigSubject.next(payload);
      } else if (topic === 'shift/total') {
        this.shiftTotalSubject.next(payload);
      } else if (topic === 'kkm/print') {
        if (payload.items && payload.items.length > 0 && payload.totalCash > 0.01) {
          payload.items.forEach((item: any) => {
            if (item.name && this.serviceNameMap[item.name]) item.name = this.serviceNameMap[item.name];
            item.cost = item.cost != null ? Math.round(Number(item.cost) * 100) / 100 : 0;
            item.pricePerSecond = item.pricePerSecond != null ? Math.round(Number(item.pricePerSecond) * 100) / 100 : 0;
            item.seconds = item.seconds != null ? Math.round(Number(item.seconds) * 100) / 100 : 0;
          });
          payload.totalCash = Math.round(Number(payload.totalCash) * 100) / 100;
          if (!payload.paymentType) payload.paymentType = 'cash';
          this.receiptService.addReceipt(payload);
          console.log(`📥 Чек из MQTT: пост ${payload.postId}`);
        }
      } else if (topic === 'posts/config') {
        this.systemConfigSubject.next(payload);
      }
    });

    this.client.on('error', (err: any) => console.error('MQTT error:', err));
    this.client.on('close', () => console.warn('MQTT connection closed'));
  }

  private async handleCardScan(topic: string, msgStr: string): Promise<void> {
    let cardNumber = '';
    let postId: string | undefined;

    try {
      const payload = JSON.parse(msgStr);
      cardNumber = String(payload.card || payload.number || payload.uid || payload.code || '').trim();
      if (payload.postId != null) postId = String(payload.postId);
    } catch {
      cardNumber = msgStr.trim();
    }

    if (!cardNumber) return;
    cardNumber = cardNumber.toUpperCase();

    if (!postId) postId = this.activePostId ?? Object.keys(this.postBalances)[0];
    const balance = postId != null ? (this.postBalances[postId] ?? 0) : 0;

    const now = Date.now();
    const canTransfer = balance > 0 && now - this.lastTransferAt > 2000;

    const event: CardScanEvent = {
      card: cardNumber, source: 'reader', timestamp: now, postId,
    };

    if (canTransfer) {
      this.lastTransferAt = now;
      try {
        const result = await firstValueFrom(
          this.clientCardService.topUpFromPost(cardNumber, postId!, balance),
        );
        this.postBalances[postId!] = 0;
        this.sendCommand(postId!, 'reset_balance');
        event.topUpAmount = balance;
        event.topUpStatus = 'ok';
        event.topUpResult = result;
      } catch (err) {
        console.error(`❌ Ошибка переноса с поста ${postId} на ${cardNumber}`, err);
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

  reconnectFromSettings(settings?: any): void {
    if (!settings) return;
    let url = '';
    if (settings.brokerUrl) url = settings.brokerUrl;
    else if (settings.local?.host) {
      const port = settings.local.portWs || 8083;
      let path = settings.local.path || '/mqtt';
      if (!path.startsWith('/')) path = '/' + path;
      url = `ws://${settings.local.host}:${port}${path}`;
    }
    if (!url) {
      console.warn('reconnectFromSettings: пустые настройки, пропускаем');
      return;
    }
    this.connect(url, settings.local?.username, settings.local?.password);
  }

  sendCommand(postId: string, command: string) {
    if (this.client && this.client.connected) {
      this.client.publish(`posts/${postId}/command`, JSON.stringify({ command }));
    } else {
      this.pendingCommands.push({ postId, command });
    }
  }

  printReceipt(receiptData: ReceiptData) {
    if (this.client && this.client.connected) {
      this.client.publish('kkm/print', JSON.stringify(receiptData));
    }
  }

  publishRelayStatus(postId: string, status: any) {
    if (this.client && this.client.connected) {
      this.client.publish(`posts/${postId}/status_relay`, JSON.stringify(status));
    }
  }

  publishConfig(services: ServiceConfig[]) {
    if (!this.client || !this.client.connected) return;
    this.admin.getSettings().subscribe((settings) => {
      const count = settings.numberOfPosts || 8;
      for (let i = 1; i <= count; i++) {
        this.client.publish(`posts/${i}/config`, JSON.stringify({ services }), { retain: true, qos: 1 });
      }
    });
  }

  getPostStatusUpdates() { return this.postStatusSubject.asObservable(); }
  getSystemConfigUpdates() { return this.systemConfigSubject.asObservable(); }
  getShiftTotalUpdates() { return this.shiftTotalSubject.asObservable(); }
  getLwtStatus() { return this.lwtStatusSubject.asObservable(); }
  getCardScanUpdates() { return this.cardScanSubject.asObservable(); }
  getCardBalanceUpdates() { return this.cardBalanceSubject.asObservable(); }

  isOnline(postId: string): boolean { return this.onlineStatusMap[postId] || false; }
  isConnected(): boolean { return this.client?.connected || false; }

  requestCardScan(): void {
    if (!this.client || !this.client.connected) return;
    this.client.publish('card-reader/command', JSON.stringify({ action: 'scan' }));
  }

  emitCardScan(card: string): void {
    const normalized = String(card || '').trim().toUpperCase();
    if (!normalized) return;
    this.cardScanSubject.next({ card: normalized, source: 'manual', timestamp: Date.now() });
  }

  setActivePost(postId: string | null): void {
    this.activePostId = postId ? String(postId) : null;
  }

  getActivePost(): string | null { return this.activePostId; }
  getPostBalance(postId: string): number { return this.postBalances[String(postId)] ?? 0; }
  getPostBalancesSnapshot(): { [postId: string]: number } { return { ...this.postBalances }; }
}