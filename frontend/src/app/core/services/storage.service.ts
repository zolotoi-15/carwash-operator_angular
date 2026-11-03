import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class StorageService {
  set<T>(k: string, v: T): void { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  get<T>(k: string): T | null { try { const i = localStorage.getItem(k); return i ? JSON.parse(i) : null; } catch { return null; } }
  remove(k: string): void { localStorage.removeItem(k); }
}
