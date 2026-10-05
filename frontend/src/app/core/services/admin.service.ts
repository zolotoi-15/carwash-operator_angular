import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ServiceConfig {
  name: string;
  price: number;
  free_time_sec: number;
}

export interface PostSettings {
  postId: number;
  services: ServiceConfig[];            // 👈 обязательно, без ?
  relayMask: Record<string, boolean>;
  vfdFrequencies: Record<string, number>;
  dimmerMask: Record<string, boolean>;
  buttonInputs: Record<string, boolean>;
  relayDelays: Record<string, { onDelay: number; offDelay: number }>;
}

export interface GeneralSettings {
  posts: PostSettings[];
  mqtt: { host: string; port: number };
  kkm: { enabled: boolean; model: string };
}

// 👇 Экспорт, которого не хватало
export const emptyPostSettings: PostSettings = {
  postId: 0,
  services: [],
  relayMask: {},
  vfdFrequencies: {},
  dimmerMask: {},
  buttonInputs: {},
  relayDelays: {}
};

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/admin`;

  private mockSettings: GeneralSettings = {
    posts: [{ ...emptyPostSettings, postId: 1 }],
    mqtt: { host: 'localhost', port: 1883 },
    kkm: { enabled: false, model: '' }
  };

  getSettings(): Observable<GeneralSettings> {
    return of(this.mockSettings);
    // return this.http.get<GeneralSettings>(`${this.apiUrl}/settings`);
  }

  updateSettings(settings: GeneralSettings): Observable<GeneralSettings> {
    this.mockSettings = settings;
    return of(settings);
    // return this.http.put<GeneralSettings>(`${this.apiUrl}/settings`, settings);
  }

  updatePostSettings(postId: number, ps: PostSettings): Observable<PostSettings> {
    const idx = this.mockSettings.posts.findIndex(p => p.postId === postId);
    if (idx >= 0) this.mockSettings.posts[idx] = ps;
    return of(ps);
    // return this.http.put<PostSettings>(`${this.apiUrl}/posts/${postId}`, ps);
  }

  copySettingsFromPost1ToAll(): Observable<void> {
    const post1 = this.mockSettings.posts[0];
    this.mockSettings.posts = this.mockSettings.posts.map(p => ({
      ...p,
      services: [...post1.services],
      relayMask: { ...post1.relayMask },
      vfdFrequencies: { ...post1.vfdFrequencies },
      dimmerMask: { ...post1.dimmerMask },
      buttonInputs: { ...post1.buttonInputs },
      relayDelays: { ...post1.relayDelays }
    }));
    return of(void 0);
    // return this.http.post<void>(`${this.apiUrl}/posts/copy-from-first`, {});
  }
}