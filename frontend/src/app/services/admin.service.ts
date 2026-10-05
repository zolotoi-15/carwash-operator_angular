import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, switchMap } from 'rxjs';
import { ServiceConfig } from './mqtt.service';

export interface PostSettings {
  prices?: { [key: string]: number };
  relayMask?: { [key: string]: number };
  vfdFrequencies?: { [key: string]: number };
  dimmerMask?: { [key: string]: number };
  buttonInputs?: { [key: string]: number };
  relayDelays?: { [key: string]: { onDelay: number; offDelay: number } };
  services?: ServiceConfig[];
}

export interface AppSettings {
  numberOfPosts: number;
  posts?: { [postId: string]: PostSettings };
  cameras?: { [key: string]: string };
  mqtt?: { brokerUrl: string; username?: string; password?: string };
  kkmManual?: { kkNumber?: string; fiscalShiftNumber?: number; cashierName?: string };
  kkm?: { enabled?: boolean; mockReceipt?: boolean };
  tankLevels?: { [key: string]: number };
  tankLowThreshold?: { [key: string]: number };
  pausePrice?: number;
  pauseFreeTimeSec?: number;
  // Старые поля для обратной совместимости
  prices?: { [key: string]: number };
  services?: ServiceConfig[];
  vfdFrequencies?: { [key: string]: number };
  relayMask?: { [key: string]: number };
  dimmerMask?: { [key: string]: number };
  buttonInputs?: { [key: string]: number };
  relayDelays?: { [key: string]: { onDelay: number; offDelay: number } };
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  constructor(private http: HttpClient) { }

  getSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>('/api/settings');
  }

  updateSettings(settings: Partial<AppSettings>): Observable<any> {
    return this.http.put('/api/settings', settings);
  }

  getPosts(): Observable<any> {
    return this.http.get('/api/posts');
  }

  publishConfig(): Observable<any> {
    return this.http.post('/api/publish-config', {});
  }

  // Новые методы для работы с постами
  getPostSettings(postId: number): Observable<PostSettings> {
    return this.getSettings().pipe(
      map(settings => settings.posts?.[postId] || {})
    );
  }

  updatePostSettings(postId: number, postSettings: PostSettings): Observable<any> {
    return this.getSettings().pipe(
      switchMap(settings => {
        const posts = settings.posts || {};
        posts[postId] = { ...posts[postId], ...postSettings };
        return this.updateSettings({ posts });
      })
    );
  }

  // ---- НОВЫЙ МЕТОД: копирование настроек с поста 1 на все остальные ----
  copySettingsFromPost1ToAll(): Observable<any> {
    return this.getSettings().pipe(
      switchMap(settings => {
        if (!settings.posts || !settings.posts[1]) {
          throw new Error('Настройки поста 1 не найдены');
        }
        const post1Settings = settings.posts[1];
        const numberOfPosts = settings.numberOfPosts || 8;
        const newPosts: { [postId: string]: any } = {};
        for (let i = 1; i <= numberOfPosts; i++) {
          newPosts[i] = {
            prices: { ...post1Settings.prices },
            relayMask: { ...post1Settings.relayMask },
            vfdFrequencies: { ...post1Settings.vfdFrequencies },
            dimmerMask: { ...post1Settings.dimmerMask },
            buttonInputs: { ...post1Settings.buttonInputs },
            relayDelays: { ...post1Settings.relayDelays },
            services: post1Settings.services ? post1Settings.services.map(s => ({ ...s })) : []
          };
        }
        // Сохраняем обновлённые настройки
        return this.updateSettings({ posts: newPosts });
      })
    );
  }
}
