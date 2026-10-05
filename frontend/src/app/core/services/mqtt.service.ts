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
  private readonly MAX_PENDING_COMMANDS = 50;

  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 15;
  private reconnectTimer: any = null;

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

  // ============================================================
  // Инициализация: Angular подключается ТОЛЬКО к локальному брокеру
  // ============================================================
  private async initMqttSettings() {
    try {
      const settings = await firstValueFrom(this.admin.getSettings());
      const mqttCfg: any = settings?.mqtt || {};
      this.applyMqttSettings(mqttCfg);
      return;
    } catch (e) {
      console.warn('Не удалось загрузить настройки MQTT с бэкенда', e);
    }

    const fallback = `ws://${window.location.hostname}:8083/mqtt`;
    console.warn('MQTT fallback:', fallback);
    this.connect(fallback, 'admin', 'Zavulon56');
  }

  reconnectFromSettings(mqttCfg: any): void {
    this.applyMqttSettings(mqttCfg);
  }

  private applyMqttSettings(mqttCfg: any): void {
    const local = mqttCfg?.local || {};
    let host = local.host;
    let port = local.portWs;
    let path = local.path;
    let user = local.username;
    let pass = local.password;

    // Legacy fallback
    if ((!host || host === '0.0.0.0') && mqttCfg?.brokerUrl) {
      try {
        const u = new URL(mqttCfg.brokerUrl);
        host = u.hostname;
        port = Number(u.port) || 8083;
        path = u.pathname || '/mqtt';
        user = user || mqttCfg.username;
        pass = pass || mqttCfg.password;
      } catch {}
    }

    host = (host && host !== '0.0.0.0') ? host : window.location.hostname;
    port = port ?? 8083;
    path = path ?? '/mqtt';

    const url = `ws://${host}:${port}${path}`;
    console.log('MQTT URL:', url);
    this.connect(url, user, pass);
  }

  // ============================================================
  // Подключение
  // ============================================================
  connect(brokerUrl: string, username?: string, password?: string) {
    let normalizedUrl = brokerUrl;
    if (brokerUrl.startsWith('mqtt://')) {
      normalizedUrl = brokerUrl.replace('mqtt://', 'ws://');
    } else if (brokerUrl.startsWith('mqtts://')) {
      normalizedUrl = brokerUrl.replace('mqtts://', 'wss://');
    }

    if (this.client) { this.client.end(true); this.client = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

    this.brokerUrl = normalizedUrl;
    this.username = username || '';
    this.password = password || '';

    const options: any = {
      clientId: 'carwash_' + Math.random().toString(16).substring(2, 10),
      connectTimeout: 5000,
      reconnectPeriod: 0,
    };
    if (this.username) options.username = this.username;
    if (this.password) options.password = this.password;

    console.log(`MQTT connect: ${this.brokerUrl}`);
    this.client = mqtt.connect(this.brokerUrl, options);

    this.client.on('connect', () => {
      console.log('✅ MQTT connected:', this.brokerUrl);
      this.reconnectAttempts = 0;

      this.client.subscribe('posts/+/status');
      this.client.subscribe('posts/+/lwt');
      this.client.subscribe('posts/+/local_LWT');
      this.client.subscribe('posts/+/config');
      this.client.subscribe('posts/+/clientcard');
      this.client.subscribe('posts/+/clientcardbalance');
      this.client.subscribe('posts/+/status_relay');
      this.client.subscribe('system/config');
      this.client.subscribe('shift/total');
      this.client.subscribe('kkm/print');
      this.client.subscribe('card-reader/scan');
      this.client.subscribe('cards/+/scan');

      if (this.pendingCommands.length) {
        const cmds = [...this.pendingCommands];
        this.pendingCommands = [];
        cmds.forEach(({ postId, command }) => this.sendCommand(postId, command));
      }
    });

    this.client.on('message', (topic: string, message: any) => {
      const msgStr = message.toString();

      // Карт-ридер
      if (
        topic === 'card-reader/scan' ||
        (topic.startsWith('cards/') && topic.endsWith('/scan')) ||
        (topic.startsWith('posts/') && topic.endsWith('/clientcard'))
      ) {
        this.handleCardScan(topic, msgStr);
        return;
      }

      // LWT
      if (topic.endsWith('/lwt') || topic.endsWith('/local_LWT')) {
        const postId = topic.split('/')[1];
        const online = msgStr === 'online' || msgStr === 'true';
        this.onlineStatusMap[postId] = online;
        this.lwtStatusSubject.next({ postId, online });
        console.log(`📡 Пост ${postId}: ${online ? '🟢' : '🔴'}`);
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
            const num = Math.round(Number(rawBalance) * 100) / 100;
            if (!isNaN(num)) this.postBalances[postId] = num;
          }
          this.postStatusSubject.next({ postId, data: payload });
        } else if (subtopic === 'clientcardbalance') {
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

    this.client.on('error', (err: any) => {
      console.error('MQTT error:', err.message || err);
    });

    if (this.client.stream) {
      this.client.stream.on('error', (err: any) => {
        console.error('MQTT WS stream error:', err.message || err);
      });
    }

    this.client.on('close', () => {
      console.warn('MQTT closed');
      this.scheduleReconnect();
    });

    this.client.on('offline', () => {
      console.warn('MQTT offline');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.MAX_RECONNECT_ATTEMPTS) {
      console.error('❌ Лимит попыток MQTT исчерпан');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`MQTT retry #${this.reconnectAttempts} через ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.brokerUrl, this.username, this.password);
    }, delay);
  }

  // ============================================================
  // Карт-ридер
  // ============================================================
  private async handleCardScan(topic: string, msgStr: string): Promise<void> {
    let cardNumber = '';
    let postId: string | undefined;

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
      console.warn('⚠️ Пустая карта');
      return;
    }
    cardNumber = cardNumber.toUpperCase();

    if (!postId) postId = this.activePostId ?? Object.keys(this.postBalances)[0];

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
      } catch (e) {
        topUpStatus = 'error';
        console.error('❌ Ошибка переноса баланса:', e);
      }
    }

    this.cardScanSubject.next({
      card: cardNumber, source: 'reader', timestamp: Date.now(),
      postId, topUpAmount: balance, topUpStatus, topUpResult,
    });
  }

  // ============================================================
  // Публичные методы
  // ============================================================
  reconnect(brokerUrl: string, username?: string, password?: string) {
    this.reconnectAttempts = 0;
    this.connect(brokerUrl, username, password);
  }

  sendCommand(postId: string, command: string) {
    if (this.client?.connected) {
      this.client.publish(`posts/${postId}/command`, JSON.stringify({ command }));
    } else {
      if (this.pendingCommands.length >= this.MAX_PENDING_COMMANDS) {
        this.pendingCommands.shift();
      }
      console.warn(`MQTT offline, команда "${command}" в очередь (пост ${postId})`);
      this.pendingCommands.push({ postId, command });
    }
  }

  printReceipt(receiptData: any) {
  if (this.client?.connected) {
    this.client.publish('kkm/print', JSON.stringify(receiptData));
  }
}

  publishRelayStatus(postId: string, status: any): void {
    if (this.client?.connected) {
      this.client.publish(`posts/${postId}/status_relay`, JSON.stringify(status), { qos: 0 });
    }
  }

  publishConfig(services: ServiceConfig[]) {
    if (!this.client?.connected) { console.warn('MQTT не подключён'); return; }
    const config = { services };
    this.admin.getSettings().subscribe(settings => {
      const count = settings.numberOfPosts || 8;
      for (let i = 1; i <= count; i++) {
        this.client.publish(`posts/${i}/config`, JSON.stringify(config), { retain: true, qos: 1 });
      }
    });
  }

  getPostStatusUpdates() { return this.postStatusSubject.asObservable(); }
  getSystemConfigUpdates() { return this.systemConfigSubject.asObservable(); }
  getShiftTotalUpdates() { return this.shiftTotalSubject.asObservable(); }
  getLwtStatus() { return this.lwtStatusSubject.asObservable(); }
  getCardScanUpdates() { return this.cardScanSubject.asObservable(); }

  isOnline(postId: string): boolean { return this.onlineStatusMap[postId] || false; }
  isConnected(): boolean { return this.client?.connected || false; }

  requestCardScan(): void {
    if (!this.client?.connected) return;
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