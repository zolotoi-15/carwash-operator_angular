// src/app/services/local-post.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import {
  ReceiptService,
  ReceiptItem as LocalReceiptItem,
} from './receipt.service';
import {
  ReceiptData,
  ReceiptItem as MqttReceiptItem,
} from '../models/receipt.model';
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
  pricePerSecond: number;
}

export interface PostOfflineMode {
  postId: string;
  offline: boolean;
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
  pricePerSecond: 0,
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

  // Режим offline/online
  private offlinePosts = new Map<string, boolean>();
  private offlineSubject = new BehaviorSubject<PostOfflineMode[]>([]);
  private lwtSub: Subscription | null = null;
  private cardBalanceSub: Subscription | null = null;

  private readonly PROGRAM_RELAY_BIT: { [program: string]: number } = {
    water: 1 << 0,
    foam: 1 << 1,
    wax: 1 << 2,
    teflon: 1 << 3,
    osmosis: 1 << 4,
    hotWater: 1 << 5,
    waterFoam: (1 << 0) | (1 << 1),
    turbo: 1 << 7,
  };

  constructor(
    private receiptService: ReceiptService,
    private mqttService: MqttService,
    private admin: AdminService,
  ) {
    // Услуги из /api/settings
    this.admin.getSettings().subscribe((settings) => {
      const post1Settings = settings.posts?.[1];
      if (post1Settings?.services) {
        this.availableServices = post1Settings.services;
        this.servicesSubject.next(this.availableServices);
        this.updatePricesFromServices(this.availableServices);
        console.log(
          '📦 LocalPostService: services loaded from /api/settings',
          this.availableServices.map(
            (s: ServiceConfig) => `${s.name}=${s.price}`,
          ),
        );
      }
    });

    // Услуги из MQTT system/config
    this.mqttService.getSystemConfigUpdates().subscribe((config) => {
      if (config && config.services && Array.isArray(config.services)) {
        this.availableServices = config.services;
        this.servicesSubject.next(this.availableServices);
        this.updatePricesFromServices(this.availableServices);
        console.log(
          '📦 LocalPostService: services loaded from MQTT',
          this.availableServices.map(
            (s: ServiceConfig) => `${s.name}=${s.price}`,
          ),
        );
      }
    });

    // Подписка на LWT ESP32
    this.lwtSub = this.mqttService.getLwtStatus().subscribe((status) => {
      const postId = status.postId;
      const wasOffline = this.offlinePosts.get(postId) === true;
      const nowOffline = !status.online;

      this.offlinePosts.set(postId, nowOffline);
      this.emitOfflineUpdate(postId, nowOffline);

      if (wasOffline && !nowOffline) {
        console.log(`🔌 Пост ${postId}: ESP32 ONLINE — LocalPostService отключается`);
        this.forceStopLocal(postId, 'esp32-online');
      } else if (!wasOffline && nowOffline) {
        console.log(`🔌 Пост ${postId}: ESP32 OFFLINE — LocalPostService активен`);
      }
    });

    // 🔥 Подписка на обновления баланса карты из MQTT (posts/+/clientcardbalance).
    // Применяем только для тех постов, что сейчас в offline-режиме —
    // иначе источником истины остаётся ESP32.
    this.cardBalanceSub = this.mqttService
      .getCardBalanceUpdates()
      .subscribe(({ postId, balance }) => {
        if (!this.isPostOffline(postId)) return;
        const state = this.getPostState(postId);
        state.balance = this.roundCents(balance);
        this.emitUpdate(postId);
      });
  }

  // ============================================================
  // Публичные методы проверки режима
  // ============================================================
  isPostOffline(postId: string): boolean {
    return this.offlinePosts.get(postId) === true;
  }

  getOfflineModeObservable() {
    return this.offlineSubject.asObservable();
  }

  private emitOfflineUpdate(postId: string, offline: boolean): void {
    const current = this.offlineSubject.value.filter(
      (p: PostOfflineMode) => p.postId !== postId,
    );
    current.push({ postId, offline });
    this.offlineSubject.next(current);
  }

  private publishState(postId: string) {
    if (!this.mqttService.isConnected()) return;
    if (!this.isPostOffline(postId)) return;

    const state = this.getPostState(postId);
    const status = {
      busy: state.busy,
      paused: state.paused,
      currentProgram: state.currentProgram,
      balance: this.roundCents(state.balance),
      elapsedSec: Math.round(state.elapsedSec * 100) / 100,
      totalPaid: this.roundCents(state.totalPaid),
      receiptCount: state.receiptCount,
      source: 'local',
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
    services.forEach((s: ServiceConfig) => {
      if (typeof s.price === 'number' && !isNaN(s.price)) {
        prices[s.name] = s.price;
      }
      freeTimes[s.name] = s.free_time_sec || 0;
    });
    this.prices = prices;
    this.freeTimes = freeTimes;
  }

  updatePrices(prices: { [program: string]: number }) {
    if (!prices) return;
    this.prices = { ...this.prices, ...prices };
  }

  // ---- Баланс ----
  addBalance(postId: string, amount: number) {
    if (!this.isPostOffline(postId)) {
      console.warn(`❌ Пост ${postId}: ESP32 online — пополнение запрещено`);
      return;
    }
    const state = this.getPostState(postId);
    state.balance = this.roundCents(state.balance + amount);
    state.totalPaid = this.roundCents(state.totalPaid + amount);
    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  // ---- Запуск программы ----
  startProgram(postId: string, programName: string) {
    if (!this.isPostOffline(postId)) {
      console.warn(`❌ Пост ${postId}: ESP32 online — локальный запуск запрещён`);
      return;
    }

    const state = this.getPostState(postId);

    if (state.busy && state.currentProgram === programName) return;

    const service = this.availableServices.find(
      (s: ServiceConfig) => s.name === programName,
    );
    if (!service) {
      console.warn(`❌ Услуга "${programName}" не найдена`);
      return;
    }

    const rawPrice = Number(service.price);
    if (isNaN(rawPrice) || rawPrice <= 0) {
      console.error(
        `❌ Услуга "${programName}" имеет некорректную цену: ${service.price}`,
      );
      return;
    }

    const priceCentsPerSec = Math.round((rawPrice * 100) / 60);
    const priceRubPerSec = priceCentsPerSec / 100;

    if (state.balance < 0.01) {
      console.warn(`❌ Недостаточно средств: ${state.balance.toFixed(2)} ₽`);
      return;
    }

    if (state.busy) this.stopProgram(postId, false);

    state.busy = true;
    state.paused = false;
    state.currentProgram = programName;
    state.elapsedSec = 0;
    state.servicesUsage = {};
    state.receiptSent = false;
    state.pricePerSecond = priceRubPerSec;

    console.log(
      `▶️ [LOCAL] Пост ${postId}: "${programName}", ${priceCentsPerSec} коп/сек`,
    );

    this.startTimer(postId);
    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  togglePause(postId: string) {
    if (!this.isPostOffline(postId)) return;
    const state = this.getPostState(postId);
    if (!state.busy) return;

    if (state.currentProgram === 'Пауза') {
      this.stopProgram(postId, false);
      return;
    }

    this.stopProgram(postId, false);
    const pauseService = this.availableServices.find(
      (s: ServiceConfig) => s.name === 'Пауза',
    );
    if (pauseService) this.startProgram(postId, 'Пауза');

    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  stopProgram(postId: string, printReceipt = true) {
    const state = this.getPostState(postId);
    if (!state.busy) return;

    const hasUsage = Object.keys(state.servicesUsage).some(
      (key) => state.servicesUsage[key].seconds > 0.001,
    );

    if (printReceipt && hasUsage) {
      this.printReceipt(postId);
    } else if (printReceipt && !hasUsage) {
      console.log(`ℹ️ [LOCAL] Пост ${postId}: нет услуг для чека`);
    }

    clearInterval(state.timer);
    state.timer = null;
    state.busy = false;
    state.paused = false;
    state.currentProgram = '-';
    state.elapsedSec = 0;
    state.pricePerSecond = 0;
    (state as any)._badPriceWarned = false;

    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  private forceStopLocal(postId: string, reason: string) {
    const state = this.getPostState(postId);
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    const wasBusy = state.busy;

    state.busy = false;
    state.paused = false;
    state.currentProgram = '-';
    state.elapsedSec = 0;
    state.pricePerSecond = 0;
    state.servicesUsage = {};
    state.balance = 0;
    state.totalPaid = 0;
    state.receiptCount = 0;
    state.receiptSent = false;
    (state as any)._badPriceWarned = false;

    if (wasBusy) {
      console.log(`🛑 [LOCAL] Пост ${postId}: сеанс прерван (${reason})`);
    }

    this.emitUpdate(postId);
  }

  resetPost(postId: string) {
    if (!this.isPostOffline(postId)) return;
    const state = this.getPostState(postId);
    clearInterval(state.timer);
    this.posts.set(postId, { ...DEFAULT_STATE, timer: null });
    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
    this.publishState(postId);
  }

  printReceipt(postId: string): boolean {
    const state = this.getPostState(postId);
    if (state.receiptSent) return false;

    const localItems: LocalReceiptItem[] = [];
    const mqttItems: MqttReceiptItem[] = [];
    let totalCash = 0;

    for (const [program, usage] of Object.entries(state.servicesUsage)) {
      if (usage.seconds > 0.001) {
        const cost = this.roundCents(usage.cost);
        const seconds = Math.round(usage.seconds * 100) / 100;
        const pricePerSec = seconds > 0 ? this.roundCents(cost / seconds) : 0;
        localItems.push({
          name: program,
          seconds,
          cost,
          pricePerSecond: pricePerSec,
        });
        mqttItems.push({
          name: program,
          price: pricePerSec,
          quantity: seconds,
          department: 1,
          tax: 4,
        });
        totalCash += cost;
      }
    }

    if (localItems.length === 0 || totalCash < 0.01) return false;
    totalCash = this.roundCents(totalCash);

    if (this.mqttService.isConnected()) {
      const receiptData: ReceiptData = {
        postId: postId,
        items: mqttItems,
        totalCash: totalCash,
        cashierName: 'Оператор (локально)',
        receiptNumber: Date.now() % 1000000,
        operation: 'Автоматический чек',
        timestamp: new Date(),
        balance: state.balance,
      };
      this.mqttService.printReceipt(receiptData);
    } else {
      this.receiptService.addReceipt({
        postId: Number(postId),
        balance: state.balance,
        totalCash: totalCash,
        items: localItems,
        timestamp: new Date().toISOString(),
        operation: 'Автоматический чек (локальный)',
      });
    }

    state.servicesUsage = {};
    state.receiptCount++;
    state.receiptSent = true;
    this.emitUpdate(postId);
    this.publishState(postId);
    return true;
  }

  syncFromMqtt(postId: string, mqttData: any) {
    if (mqttData.source === 'local') return;
    const state = this.getPostState(postId);

    if (this.isPostOffline(postId) && state.timer !== null && state.busy) return;

    if (mqttData.busy !== undefined) state.busy = mqttData.busy;
    if (mqttData.paused !== undefined) state.paused = mqttData.paused;
    if (mqttData.currentProgram !== undefined)
      state.currentProgram = mqttData.currentProgram;
    if (mqttData.elapsedSec !== undefined) state.elapsedSec = mqttData.elapsedSec;
    if (mqttData.balance !== undefined)
      state.balance = this.roundCents(mqttData.balance);
    if (mqttData.totalPaid !== undefined)
      state.totalPaid = this.roundCents(mqttData.totalPaid);
    if (mqttData.receiptCount !== undefined)
      state.receiptCount = mqttData.receiptCount;
    if (mqttData.pricePerSecond !== undefined)
      state.pricePerSecond = mqttData.pricePerSecond;

    if (mqttData.busy === false && !this.isPostOffline(postId)) {
      clearInterval(state.timer);
      state.timer = null;
      state.paused = false;
      state.currentProgram = '-';
      state.elapsedSec = 0;
      state.servicesUsage = {};
      state.pricePerSecond = 0;
    }

    this.emitUpdate(postId);
    this.publishRelayStatus(postId);
  }

  private startTimer(postId: string) {
    const state = this.getPostState(postId);
    clearInterval(state.timer);

    state.timer = setInterval(() => {
      if (!state.busy || state.paused) return;

      if (!this.isPostOffline(postId)) {
        this.forceStopLocal(postId, 'esp32-back-online');
        return;
      }

      const prog = state.currentProgram;
      const pricePerSec = state.pricePerSecond;
      const free = this.freeTimes[prog] || 0;
      const deltaSec = this.TICK_INTERVAL_MS / 1000;

      if (isNaN(pricePerSec) || pricePerSec <= 0) {
        if (!(state as any)._badPriceWarned) {
          console.error(`❌ [LOCAL] Пост ${postId}: неверная цена для "${prog}"`);
          (state as any)._badPriceWarned = true;
        }
        this.stopProgram(postId, false);
        return;
      }

      state.elapsedSec += deltaSec;

      if (state.elapsedSec <= free) {
        if (!state.servicesUsage[prog])
          state.servicesUsage[prog] = { seconds: 0, cost: 0 };
        state.servicesUsage[prog].seconds += deltaSec;
        this.emitUpdate(postId);
        return;
      }

      const priceCentsPerSec = Math.round(pricePerSec * 100);
      const balanceCents = Math.round(state.balance * 100);

      if (balanceCents >= priceCentsPerSec) {
        state.balance = (balanceCents - priceCentsPerSec) / 100;
        if (!state.servicesUsage[prog])
          state.servicesUsage[prog] = { seconds: 0, cost: 0 };
        state.servicesUsage[prog].seconds += deltaSec;
        state.servicesUsage[prog].cost = this.roundCents(
          state.servicesUsage[prog].cost + pricePerSec,
        );
        this.emitUpdate(postId);
      } else {
        const remainingCents = balanceCents;
        if (remainingCents > 0) {
          const fractionSec = remainingCents / priceCentsPerSec;
          state.balance = 0;
          state.elapsedSec += fractionSec;
          if (!state.servicesUsage[prog])
            state.servicesUsage[prog] = { seconds: 0, cost: 0 };
          state.servicesUsage[prog].seconds += fractionSec;
          state.servicesUsage[prog].cost = this.roundCents(
            state.servicesUsage[prog].cost + remainingCents / 100,
          );
          this.emitUpdate(postId);
        }
        this.stopProgram(postId, true);
      }
    }, this.TICK_INTERVAL_MS);
  }

  private publishRelayStatus(postId: string) {
    if (!this.isPostOffline(postId)) return;
    const state = this.getPostState(postId);
    const mask =
      state.busy && state.currentProgram !== '-'
        ? this.PROGRAM_RELAY_BIT[state.currentProgram] || 0
        : 0;

    const status = {
      busy: state.busy,
      paused: state.paused,
      currentProgram: state.currentProgram,
      relayMask: mask,
    };
    this.mqttService.publishRelayStatus(postId, status);
  }

  private emitUpdate(postId: string) {
    const state = this.getPostState(postId);
    this.postsSubject.next([{ postId, state: { ...state } }]);
  }

  private roundCents(value: number): number {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    return Math.round(value * 100) / 100;
  }
}