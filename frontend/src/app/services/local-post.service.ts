// src/app/services/local-post.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ReceiptService, ReceiptItem as LocalReceiptItem } from './receipt.service';
import { ReceiptData, ReceiptItem as MqttReceiptItem } from '../models/receipt.model';
import { MqttService, ServiceConfig } from './mqtt.service';
import { AdminService } from './admin.service';

export interface PostState {
  busy: boolean;
  paused: boolean;
  balance: number;
  currentProgram: string;
  elapsedSec: number;
  totalPaid: number;
  receiptCount: number;
  timer: any;
  servicesUsage: { [program: string]: { seconds: number; cost: number } };
  receiptSent: boolean;
  pricePerSecond: number; // добавлено для таймера
}

const DEFAULT_STATE: PostState = {
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
  pricePerSecond: 0
};

@Injectable({ providedIn: 'root' })
export class LocalPostService {
  private posts = new Map<string, PostState>();
  private postsSubject = new BehaviorSubject<{ postId: string; state: PostState }[]>([]);
  private availableServices: ServiceConfig[] = [];
  private servicesSubject = new BehaviorSubject<ServiceConfig[]>([]);
  private prices: { [program: string]: number } = {};
  private freeTimes: { [program: string]: number } = {};
  private readonly TICK_INTERVAL_MS = 1000;

  private readonly PROGRAM_RELAY_BIT: { [program: string]: number } = {
    water: 1 << 0,
    foam: 1 << 1,
    wax: 1 << 2,
    teflon: 1 << 3,
    osmosis: 1 << 4,
    hotWater: 1 << 5,
    waterFoam: (1 << 0) | (1 << 1),
    turbo: 1 << 7
  };

  constructor(
    private receiptService: ReceiptService,
    private mqttService: MqttService,
    private admin: AdminService
  ) {
    this.admin.getSettings().subscribe(settings => {
      const post1Settings = settings.posts?.[1];
      if (post1Settings?.services) {
        this.availableServices = post1Settings.services;
        this.servicesSubject.next(this.availableServices);
        this.updatePricesFromServices(this.availableServices);
      }
    });
    this.mqttService.getSystemConfigUpdates().subscribe(config => {
      if (config && config.services) {
        this.availableServices = config.services;
        this.servicesSubject.next(this.availableServices);
        this.updatePricesFromServices(this.availableServices);
      }
    });
  }

  // ---- Публикация состояния в MQTT ----
  private publishState(postId: string) {
    if (!this.mqttService.isConnected()) return;
    const state = this.getPostState(postId);
    const status = {
      busy: state.busy,
      paused: state.paused,
      currentProgram: state.currentProgram,
      balance: Math.round(state.balance * 100) / 100,
      elapsedSec: Math.round(state.elapsedSec * 100) / 100,
      totalPaid: Math.round(state.totalPaid * 100) / 100,
      receiptCount: state.receiptCount,
      source: 'local'
    };
    const client = (this.mqttService as any).client;
    if (client && client.connected) {
      client.publish(`posts/${postId}/status`, JSON.stringify(status));
    }
  }

  // ---- Геттеры ----
  getPostState(postId: string): PostState {
    if (!this.posts.has(postId)) {
      this.posts.set(postId, { ...DEFAULT_STATE, timer: null });
    }
    return this.posts.get(postId)!;
  }

  getPostsObservable() {
    return this.postsSubject.asObservable();
  }

  getServicesObservable() {
    return this.servicesSubject.asObservable();
  }

  updateServices(services: ServiceConfig[]) {
    this.availableServices = services;
    this.servicesSubject.next(services);
    this.updatePricesFromServices(services);
  }

  private updatePricesFromServices(services: ServiceConfig[]) {
    const prices: { [key: string]: number } = {};
    const freeTimes: { [key: string]: number } = {};
    services.forEach(s => {
      prices[s.name] = s.price;
      freeTimes[s.name] = s.free_time_sec || 0;
    });
    this.prices = prices;
    this.freeTimes = freeTimes;
  }

  updatePrices(prices: { [program: string]: number }) {
    if (prices) {
      this.prices = { ...this.prices, ...prices };
    }
  }

  // ---- Управление балансом ----
  addBalance(postId: string, amount: number) {
    const state = this.getPostState(postId);
    state.balance += amount;
    state.totalPaid += amount;
    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  // ---- Запуск программы ----
  startProgram(postId: string, programName: string) {
    const state = this.getPostState(postId);
    if (state.busy && state.currentProgram === programName) {
      console.log(`ℹ️ Программа ${programName} уже запущена на посту ${postId}`);
      return;
    }

    const service = this.availableServices.find(s => s.name === programName);
    if (!service) {
      console.warn(`Услуга "${programName}" не найдена`);
      return;
    }

    const pricePerSec = service.price / 60;
    if (state.balance < 0.01) {
      console.warn(`Недостаточно средств на посту ${postId}`);
      return;
    }

    if (state.busy) {
      this.stopProgram(postId, true);
    }

    state.busy = true;
    state.paused = false;
    state.currentProgram = programName;
    state.elapsedSec = 0;
    state.servicesUsage = {};
    state.receiptSent = false;
    state.pricePerSecond = pricePerSec; // сохраняем цену за секунду

    this.startTimer(postId);
    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  // ---- Пауза ----
  togglePause(postId: string) {
    const state = this.getPostState(postId);
    if (!state.busy) return;

    if (state.currentProgram === 'Пауза') {
      this.stopProgram(postId, false);
      return;
    }

    this.stopProgram(postId, false);
    const pauseService = this.availableServices.find(s => s.name === 'Пауза');
    if (pauseService) {
      this.startProgram(postId, 'Пауза');
    } else {
      console.log('ℹ️ Программа "Пауза" не найдена, реле выключены');
    }
    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  // ---- Остановка программы ----
  stopProgram(postId: string, printReceipt = true) {
    const state = this.getPostState(postId);
    if (!state.busy) return;

    const hasUsage = Object.keys(state.servicesUsage).some(key => state.servicesUsage[key].seconds > 0.001);
    if (printReceipt && hasUsage) {
      this.printReceipt(postId);
    } else if (printReceipt && !hasUsage) {
      console.log(`ℹ️ Пост ${postId}: нет услуг для чека, чек не создан`);
    }

    clearInterval(state.timer);
    state.timer = null;
    state.busy = false;
    state.paused = false;
    state.currentProgram = '-';
    state.elapsedSec = 0;
    state.pricePerSecond = 0;
    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  // ---- Сброс поста ----
  resetPost(postId: string) {
    const state = this.getPostState(postId);
    clearInterval(state.timer);
    this.posts.set(postId, { ...DEFAULT_STATE, timer: null });
    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  // ---- Печать чека ----
  printReceipt(postId: string): boolean {
    const state = this.getPostState(postId);
    if (state.receiptSent) {
      console.log(`ℹ️ Пост ${postId}: чек уже напечатан, пропускаем дублирование`);
      return false;
    }

    const localItems: LocalReceiptItem[] = [];
    const mqttItems: MqttReceiptItem[] = [];
    let totalCash = 0;

    for (const [program, usage] of Object.entries(state.servicesUsage)) {
      if (usage.seconds > 0.001) {
        const cost = Math.round(usage.cost * 100) / 100;
        const pricePerSec = Math.round((cost / usage.seconds) * 100) / 100;
        const seconds = Math.round(usage.seconds * 100) / 100;

        localItems.push({ name: program, seconds, cost, pricePerSecond: pricePerSec });
        mqttItems.push({ name: program, price: pricePerSec, quantity: seconds, department: 1, tax: 4 });
        totalCash += cost;
      }
    }

    if (localItems.length === 0 || totalCash < 0.01) {
      console.warn(`⚠️ Пост ${postId}: нет данных для чека (пропускаем)`);
      return false;
    }

    totalCash = Math.round(totalCash * 100) / 100;

    if (this.mqttService.isConnected()) {
      const receiptData: ReceiptData = {
        postId: postId,
        items: mqttItems,
        totalCash: totalCash,
        cashierName: 'Оператор',
        receiptNumber: Date.now() % 1000000,
        operation: 'Автоматический чек',
        timestamp: new Date(),
        balance: state.balance
      };
      this.mqttService.printReceipt(receiptData);
    } else {
      this.receiptService.addReceipt({
        postId: Number(postId),
        balance: state.balance,
        totalCash: totalCash,
        items: localItems,
        timestamp: new Date().toISOString(),
        operation: 'Автоматический чек'
      });
    }

    state.servicesUsage = {};
    state.receiptCount++;
    state.receiptSent = true;
    this.emitUpdate(postId);
    this.publishState(postId);
    return true;
  }

  // ---- Синхронизация с MQTT ----
  syncFromMqtt(postId: string, mqttData: any) {
    if (mqttData.source === 'local') return;

    const state = this.getPostState(postId);
    if (mqttData.busy !== undefined) state.busy = mqttData.busy;
    if (mqttData.paused !== undefined) state.paused = mqttData.paused;
    if (mqttData.currentProgram !== undefined) state.currentProgram = mqttData.currentProgram;
    if (mqttData.elapsedSec !== undefined) state.elapsedSec = mqttData.elapsedSec;
    if (mqttData.balance !== undefined) state.balance = mqttData.balance;
    if (mqttData.totalPaid !== undefined) state.totalPaid = mqttData.totalPaid;
    if (mqttData.receiptCount !== undefined) state.receiptCount = mqttData.receiptCount;

    // Если пришла цена за секунду, обновляем
    if (mqttData.pricePerSecond !== undefined) state.pricePerSecond = mqttData.pricePerSecond;

    if (mqttData.busy === false) {
      clearInterval(state.timer);
      state.timer = null;
      state.busy = false;
      state.paused = false;
      state.currentProgram = '-';
      state.elapsedSec = 0;
      state.servicesUsage = {};
      state.pricePerSecond = 0;
    }

    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
  }

  // ---- Внутренний таймер (использует сохранённую цену) ----
  private startTimer(postId: string) {
    const state = this.getPostState(postId);
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (!state.busy || state.paused) return;

      const prog = state.currentProgram;
      const pricePerSec = state.pricePerSecond;
      const free = this.freeTimes[prog] || 0;
      const deltaSec = this.TICK_INTERVAL_MS / 1000;

      if (isNaN(pricePerSec) || pricePerSec <= 0) {
        console.error(`❌ Пост ${postId}: неверная цена для программы ${prog}, останавливаем`);
        this.stopProgram(postId, false);
        return;
      }

      state.elapsedSec += deltaSec;

      if (state.elapsedSec <= free) {
        if (!state.servicesUsage[prog]) state.servicesUsage[prog] = { seconds: 0, cost: 0 };
        state.servicesUsage[prog].seconds += deltaSec;
        this.emitUpdate(postId);
        return;
      }

      if (state.balance >= pricePerSec) {
        state.balance -= pricePerSec;
        if (!state.servicesUsage[prog]) state.servicesUsage[prog] = { seconds: 0, cost: 0 };
        state.servicesUsage[prog].seconds += deltaSec;
        state.servicesUsage[prog].cost += pricePerSec;
        this.emitUpdate(postId);
      } else {
        const remaining = state.balance;
        if (remaining > 0.001) {
          const fractionSec = remaining / pricePerSec;
          state.balance = 0;
          state.elapsedSec += fractionSec;
          if (!state.servicesUsage[prog]) state.servicesUsage[prog] = { seconds: 0, cost: 0 };
          state.servicesUsage[prog].seconds += fractionSec;
          state.servicesUsage[prog].cost += remaining;
          this.emitUpdate(postId);
        }
        this.stopProgram(postId, true);
      }
    }, this.TICK_INTERVAL_MS);
  }

  // ---- Публикация статуса реле ----
  private publishRelayStatus(postId: string) {
    const state = this.getPostState(postId);
    const mask = state.busy && state.currentProgram !== '-'
      ? (this.PROGRAM_RELAY_BIT[state.currentProgram] || 0)
      : 0;

    const status = {
      busy: state.busy,
      paused: state.paused,
      currentProgram: state.currentProgram,
      relayMask: mask
    };
    this.mqttService.publishRelayStatus(postId, status);
  }

  private emitUpdate(postId: string) {
    const state = this.getPostState(postId);
    this.postsSubject.next([{ postId, state: { ...state } }]);
  }
}
