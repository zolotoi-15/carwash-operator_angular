import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

// ================= МОДЕЛИ =================

export interface ServiceConfig {
  name: string;
  price: number;
  free_time_sec: number;
  enabled?: boolean;
}

export interface PostSettings {
  postId: number;
  services: ServiceConfig[];
  relayMask: Record<string, boolean>;
  vfdFrequencies: Record<string, number>;
  dimmerMask: Record<string, boolean>;
  buttonInputs: Record<string, number>;
  relayDelays: Record<string, { onDelay: number; offDelay: number }>;
  cameras: Record<string, string>;
}

export interface KkmSettings {
  enabled: boolean;
  simulate: boolean;
  model: string;
  fiscalShiftNumber: number;
  cashierName: string;
}

export interface LocalMqttSettings {
  host: string;
  portTcp: number;
  portWs: number;
  path: string;
  username: string;
  password: string;
}

export interface RemoteMqttSettings {
  host: string;
  portTcp: number;
  portTls: number;
  portWss: number;
  username: string;
  password: string;
}

export interface MqttSettings {
  local: LocalMqttSettings;
  remote: RemoteMqttSettings;
  /** Прямой URL брокера (для совместимости со старой конфигурацией). */
  brokerUrl?: string;
}

export interface GeneralSettings {
  posts: PostSettings[];
  mqtt: MqttSettings;
  kkm: KkmSettings;
  numberOfPosts: number;
  tankLevels?: any;
  tankLowThreshold?: any;
}

// ================= ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ =================

export const emptyPostSettings: PostSettings = {
  postId: 0,
  services: [],
  relayMask: {},
  vfdFrequencies: {},
  dimmerMask: {},
  buttonInputs: {},
  relayDelays: {},
  cameras: {},
};

export const DEFAULT_MQTT: MqttSettings = {
  local: {
    host: '192.168.31.211',
    portTcp: 1883,
    portWs: 8083,
    path: '/mqtt',
    username: 'admin',
    password: 'Zavulon56',
  },
  remote: {
    host: 'm2.wqtt.ru',
    portTcp: 13257,
    portTls: 13258,
    portWss: 13260,
    username: 'u_GGENLB',
    password: 'LTHNW22D',
  },
};

export const emptyGeneralSettings: GeneralSettings = {
  posts: [],
  mqtt: DEFAULT_MQTT,
  kkm: {
    enabled: false,
    simulate: false,
    model: '',
    fiscalShiftNumber: 0,
    cashierName: '',
  },
  numberOfPosts: 8,
};

// ================= СЕРВИС =================

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}`;

  // ------- server → UI -------

  private fromServer(data: any): GeneralSettings {
    const postsObj = data?.posts || {};
    const posts: PostSettings[] = [];

    for (const [postIdStr, pdRaw] of Object.entries<any>(postsObj)) {
      const postId = Number(postIdStr);
      const pd = pdRaw || {};
      const prices = pd.prices || {};
      const services: ServiceConfig[] = (pd.services || []).map((svc: any) => ({
        name: svc.name,
        price:
          typeof svc.price === 'number'
            ? svc.price
            : typeof prices[svc.name] === 'number'
            ? prices[svc.name]
            : 0,
        free_time_sec: svc.free_time_sec ?? 0,
        enabled: svc.enabled !== undefined ? svc.enabled : svc.enable !== false,
      }));

      posts.push({
        postId,
        services,
        relayMask: pd.relayMask || {},
        vfdFrequencies: pd.vfdFrequencies || {},
        dimmerMask: pd.dimmerMask || {},
        buttonInputs: pd.buttonInputs || {},
        relayDelays: pd.relayDelays || {},
        cameras: pd.cameras || {},
      });
    }

    posts.sort((a, b) => a.postId - b.postId);

    // MQTT — нормализуем (новый формат { local, remote }, старый { brokerUrl })
    const mqttRaw = data?.mqtt || {};
    let mqtt: MqttSettings;
    if (mqttRaw.local || mqttRaw.remote) {
      mqtt = {
        local: { ...DEFAULT_MQTT.local, ...(mqttRaw.local || {}) },
        remote: { ...DEFAULT_MQTT.remote, ...(mqttRaw.remote || {}) },
        brokerUrl: mqttRaw.brokerUrl,
      };
    } else if (mqttRaw.brokerUrl) {
      mqtt = {
        local: { ...DEFAULT_MQTT.local },
        remote: { ...DEFAULT_MQTT.remote },
        brokerUrl: mqttRaw.brokerUrl,
      };
      try {
        const u = new URL(mqttRaw.brokerUrl);
        mqtt.local.host = u.hostname;
        mqtt.local.portWs = Number(u.port) || mqtt.local.portWs;
        mqtt.local.path = u.pathname || mqtt.local.path;
        if (mqttRaw.username) mqtt.local.username = mqttRaw.username;
        if (mqttRaw.password) mqtt.local.password = mqttRaw.password;
      } catch {}
    } else {
      mqtt = { ...DEFAULT_MQTT };
    }

    return {
      ...data,
      posts,
      mqtt,
      kkm: { ...emptyGeneralSettings.kkm, ...(data?.kkm || {}) },
      numberOfPosts: data?.numberOfPosts ?? 8,
    };
  }

  // ------- UI → server -------

  private toServer(settings: GeneralSettings): any {
    // 1) posts: массив → объект-словарь
    const postsObj: any = {};
    settings.posts.forEach(p => {
      const prices: any = {};
      p.services.forEach(svc => {
        prices[svc.name] = svc.price;
      });
      postsObj[p.postId] = {
        prices,
        relayMask: p.relayMask,
        vfdFrequencies: p.vfdFrequencies,
        dimmerMask: p.dimmerMask,
        buttonInputs: p.buttonInputs,
        relayDelays: p.relayDelays,
        cameras: p.cameras,
        services: p.services.map(s => ({
          name: s.name,
          price: s.price,
          free_time_sec: s.free_time_sec ?? 0,
          enabled: s.enabled !== false,
        })),
      };
    });

    // 2) mqtt: отправляем { local, remote } — server.js это понимает
    const mqtt = {
      local: settings.mqtt?.local ?? DEFAULT_MQTT.local,
      remote: settings.mqtt?.remote ?? DEFAULT_MQTT.remote,
    };

    // 3) kkm: приводим UI-поля к серверным
    const kkmFromUi = settings.kkm || {};
    const kkm = {
      enabled: !!kkmFromUi.enabled,
      mockReceipt: !!kkmFromUi.simulate,
      provider: kkmFromUi.model || 'mock',
      manual: {
        kkNumber: '',
        fiscalShiftNumber: kkmFromUi.fiscalShiftNumber ?? null,
        cashierName: kkmFromUi.cashierName ?? '',
      },
    };

    return {
      ...settings,
      posts: postsObj,
      mqtt,
      kkm,
    };
  }

  // ================= API =================

  getSettings(): Observable<GeneralSettings> {
    return this.http
      .get<any>(`${this.apiUrl}/settings`)
      .pipe(map(data => this.fromServer(data)));
  }

  updateSettings(settings: GeneralSettings): Observable<GeneralSettings> {
    const body = this.toServer(settings);
    return this.http
      .put<any>(`${this.apiUrl}/settings`, body)
      .pipe(map(data => this.fromServer(data)));
  }

  /** Публикация текущего конфига во все посты через MQTT (POST /api/publish-config) */
  publishConfig(): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/publish-config`, {});
  }

  updatePostSettings(postId: number, ps: PostSettings): Observable<PostSettings> {
    return of(ps);
  }

  copySettingsFromPost1ToAll(): Observable<void> {
    return of(void 0);
  }
}

/**
 * Строит WebSocket-URL MQTT из настроек.
 * Приоритет: brokerUrl → local (host + portWs + path).
 * Возвращает '' если собрать не удалось.
 */
export function buildBrokerUrl(mqtt?: MqttSettings | null): string {
  if (!mqtt) return '';

  if (mqtt.brokerUrl && mqtt.brokerUrl.trim()) {
    return mqtt.brokerUrl.trim();
  }

  const local = mqtt.local;
  if (local && local.host) {
    const port = local.portWs || 8083;
    let path = local.path || '/mqtt';
    if (!path.startsWith('/')) path = '/' + path;
    return `ws://${local.host}:${port}${path}`;
  }

  return '';
}