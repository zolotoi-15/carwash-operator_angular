import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, switchMap } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { SettingsUpdateService } from './settings-update.service';

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
  /** Маска реле. Может быть числом (битовая маска) или boolean (для отдельных бит). */
  relayMask: Record<string, number | boolean>;
  vfdFrequencies: Record<string, number>;
  /** Маска диммеров. Может быть числом или boolean. */
  dimmerMask: Record<string, number | boolean>;
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
  private settingsUpdate = inject(SettingsUpdateService);
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
        enabled: svc.enabled !== false,
      }));

      // ★ Нормализация карт: у каждой услуги должна быть запись во всех картах.
      // Это защищает шаблон от ошибок вида "Cannot read properties of undefined".
      const relayMask      = pd.relayMask      || {};
      const vfdFrequencies = pd.vfdFrequencies || {};
      const dimmerMask     = pd.dimmerMask     || {};
      const buttonInputs   = pd.buttonInputs   || {};
      const relayDelays    = pd.relayDelays    || {};

      for (const svc of services) {
        if (relayMask[svc.name]      === undefined) relayMask[svc.name]      = 0;
        if (vfdFrequencies[svc.name] === undefined) vfdFrequencies[svc.name] = 40;
        if (dimmerMask[svc.name]     === undefined) dimmerMask[svc.name]     = 0;
        if (buttonInputs[svc.name]   === undefined) buttonInputs[svc.name]   = 0;
        if (relayDelays[svc.name]    === undefined) relayDelays[svc.name]    = { onDelay: 100, offDelay: 200 };
      }

      posts.push({
        postId,
        services,
        relayMask,
        vfdFrequencies,
        dimmerMask,
        buttonInputs,
        relayDelays,
        cameras: pd.cameras || {},
      });
    }

    posts.sort((a, b) => a.postId - b.postId);

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

  /**
   * ★ Пересчитывает числовые маски реле/диммеров из галочек вида "Имя_1", "Имя_2", …
   *   Это нужно, потому что UI отображает каждый бит отдельным чекбоксом,
   *   а на бэкенд (и в MQTT posts/N/config) должна уходить итоговая числовая маска.
   */
  private rebuildMasks(post: PostSettings): void {
    const relayMask  = post.relayMask  || (post.relayMask  = {});
    const dimmerMask = post.dimmerMask || (post.dimmerMask = {});

    for (const svc of post.services) {
      // Реле: 8 бит
      let relay = 0;
      let hasRelayBit = false;
      for (let r = 1; r <= 8; r++) {
        const key = `${svc.name}_${r}`;
        const v = relayMask[key];
        if (v === true)  { relay |= (1 << (r - 1)); hasRelayBit = true; }
        if (v === false) { hasRelayBit = true; }
      }
      if (hasRelayBit) {
        relayMask[svc.name] = relay;
      }

      // Диммеры: 4 бита
      let dimmer = 0;
      let hasDimmerBit = false;
      for (let d = 1; d <= 4; d++) {
        const key = `${svc.name}_${d}`;
        const v = dimmerMask[key];
        if (v === true)  { dimmer |= (1 << (d - 1)); hasDimmerBit = true; }
        if (v === false) { hasDimmerBit = true; }
      }
      if (hasDimmerBit) {
        dimmerMask[svc.name] = dimmer;
      }
    }
  }

  private toServer(settings: GeneralSettings): any {
    const postsObj: any = {};

    settings.posts.forEach(p => {
      // ★ Пересчитываем числовые маски из галочек ПЕРЕД сериализацией
      this.rebuildMasks(p);

      const prices: any = {};
      p.services.forEach(svc => {
        prices[svc.name] = svc.price;
      });

      postsObj[p.postId] = {
        prices,
        relayMask:      p.relayMask,
        vfdFrequencies: p.vfdFrequencies,
        dimmerMask:     p.dimmerMask,
        buttonInputs:   p.buttonInputs,
        relayDelays:    p.relayDelays,
        cameras:        p.cameras,
        services: p.services.map(s => ({
          name: s.name,
          price: s.price,
          free_time_sec: s.free_time_sec ?? 0,
          enabled: s.enabled !== false,
        })),
      };
    });

    const mqtt = {
      local: settings.mqtt?.local ?? DEFAULT_MQTT.local,
      remote: settings.mqtt?.remote ?? DEFAULT_MQTT.remote,
    };

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
      .pipe(
        map(data => this.fromServer(data)),
        tap(() => this.settingsUpdate.notifySettingsUpdated())
      );
  }

  publishConfig(): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/publish-config`, {});
  }

  getPostSettings(postId: number): Observable<PostSettings> {
    return this.getSettings().pipe(
      map(settings => {
        const post = settings.posts.find(p => p.postId === postId);
        if (!post) throw new Error(`Пост ${postId} не найден`);
        return post;
      })
    );
  }

  updatePostSettings(postId: number, ps: Partial<PostSettings>): Observable<PostSettings> {
    return this.getSettings().pipe(
      map(settings => {
        const idx = settings.posts.findIndex(p => p.postId === postId);
        if (idx === -1) throw new Error(`Пост ${postId} не найден`);
        settings.posts[idx] = { ...settings.posts[idx], ...ps };
        return settings;
      }),
      switchMap(updated => this.updateSettings(updated)),
      map(settings => {
        const post = settings.posts.find(p => p.postId === postId);
        if (!post) throw new Error(`Пост ${postId} не найден после обновления`);
        return post;
      })
    );
  }

  copySettingsFromPost1ToAll(): Observable<void> {
    return this.getSettings().pipe(
      map(settings => {
        const post1 = settings.posts.find(p => p.postId === 1);
        if (!post1) throw new Error('Пост 1 не найден');
        const count = settings.numberOfPosts || 8;
        const newPosts: PostSettings[] = [];
        for (let i = 1; i <= count; i++) {
          newPosts.push({ ...structuredClone(post1), postId: i });
        }
        return { ...settings, posts: newPosts };
      }),
      switchMap(updated => this.updateSettings(updated)),
      map(() => void 0)
    );
  }
}

export function buildBrokerUrl(mqtt?: MqttSettings | null): string {
  if (!mqtt) return '';
  if (mqtt.brokerUrl && mqtt.brokerUrl.trim()) return mqtt.brokerUrl.trim();
  const local = mqtt.local;
  if (local && local.host) {
    const port = local.portWs || 8083;
    let path = local.path || '/mqtt';
    if (!path.startsWith('/')) path = '/' + path;
    return `ws://${local.host}:${port}${path}`;
  }
  return '';
}