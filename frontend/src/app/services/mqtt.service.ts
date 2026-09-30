// src/app/services/mqtt.service.ts
import { Injectable } from '@angular/core';
import mqtt from 'mqtt';
import { Subject, firstValueFrom } from 'rxjs';
import { ReceiptData } from '../models/receipt.model';
import { ReceiptService } from './receipt.service';
import { AdminService } from './admin.service';

export interface ServiceConfig {
  name: string;
  price: number;
  free_time_sec?: number;
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

  constructor(
    private receiptService: ReceiptService,
    private admin: AdminService
  ) {
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
      this.client.subscribe('system/config');
      this.client.subscribe('shift/total');
      this.client.subscribe('kkm/print');
      this.client.subscribe('posts/+/lwt');
      this.client.subscribe('posts/+/local_LWT');
      this.client.subscribe('posts/config');

      localStorage.setItem('mqttSettings', JSON.stringify({
        brokerUrl,
        username: this.username,
        password: this.password
      }));

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

      // Обработка LWT и local_LWT (текстовые сообщения)
      if (topic.endsWith('/lwt') || topic.endsWith('/local_LWT')) {
        const parts = topic.split('/');
        const postId = parts[1];
        // Для LWT: 'online' или 'offline', для local_LWT: 'true' или 'false'
        const online = msgStr === 'online' || msgStr === 'true';
        this.onlineStatusMap[postId] = online;
        this.lwtStatusSubject.next({ postId, online });
        console.log(`📡 Пост ${postId}: ${online ? '🟢 онлайн' : '🔴 офлайн'}`);
        return;
      }

      // Попытка парсинга JSON
      let payload;
      try {
        payload = JSON.parse(msgStr);
      } catch (e) {
        console.warn(`⚠️ Невалидный JSON в топике ${topic}:`, msgStr);
        return;
      }

      if (topic.startsWith('posts/')) {
        const parts = topic.split('/');
        const postId = parts[1];
        const subtopic = parts[2];
        if (subtopic === 'status') {
          this.postStatusSubject.next({ postId, data: payload });
        }
      } else if (topic === 'system/config') {
        this.systemConfigSubject.next(payload);
      } else if (topic === 'shift/total') {
        this.shiftTotalSubject.next(payload);
      } else if (topic === 'kkm/print') {
        // Обработка чека
        if (payload.items && payload.items.length > 0 && payload.totalCash > 0.01) {
          payload.items.forEach((item: any) => {
            if (item.name && this.serviceNameMap[item.name]) {
              item.name = this.serviceNameMap[item.name];
            }
            item.cost = item.cost != null ? Math.round(Number(item.cost) * 100) / 100 : 0;
            item.pricePerSecond = item.pricePerSecond != null ? Math.round(Number(item.pricePerSecond) * 100) / 100 : 0;
            item.seconds = item.seconds != null ? Math.round(Number(item.seconds) * 100) / 100 : 0;
          });
          payload.totalCash = Math.round(Number(payload.totalCash) * 100) / 100;
          this.receiptService.addReceipt(payload);
          const itemsStr = payload.items.map((item: any) =>
            `${item.name}, ${item.seconds.toFixed(1)} сек, сумма ${item.cost.toFixed(2)} ₽`
          ).join('; ');
          console.log(`📥 Чек получен из MQTT: пост ${payload.postId}, ${itemsStr}`);
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

  reconnect(brokerUrl: string, username?: string, password?: string) {
    this.connect(brokerUrl, username, password);
  }

  sendCommand(postId: string, command: string) {
    if (this.client && this.client.connected) {
      const message = JSON.stringify({ command });
      this.client.publish(`posts/${postId}/command`, message);
    } else {
      console.warn(`MQTT не подключён, команда "${command}" добавлена в очередь для поста ${postId}`);
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
    this.admin.getSettings().subscribe(settings => {
      const count = settings.numberOfPosts || 8;
      for (let i = 1; i <= count; i++) {
        const topic = `posts/${i}/config`;
        this.client.publish(topic, JSON.stringify(config), { retain: true, qos: 1 });
      }
      console.log(`📤 Конфиг опубликован в posts/*/config (${count} постов)`);
    });
  }

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

  isOnline(postId: string): boolean {
    return this.onlineStatusMap[postId] || false;
  }

  isConnected(): boolean {
    return this.client?.connected || false;
  }
}
