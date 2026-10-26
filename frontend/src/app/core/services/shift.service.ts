import { Injectable, inject, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

import { CashShift } from '../models/shift.model';

export interface ShiftTotal {
  total: number;
  count: number;
}

interface CurrentShiftResponse {
  exists: boolean;
  shiftNumber?: number;
  cashier?: string;
  openedAt?: string;
  autoCloseAt?: string;
  fiscalShiftNumber?: number;
}

@Injectable({ providedIn: 'root' })
export class ShiftService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}`;

  private shiftTotalSubject = new BehaviorSubject<ShiftTotal>({ total: 0, count: 0 });
  private currentShiftSubject = new BehaviorSubject<CashShift | null>(null);

  private lastKnownShiftNumber: number | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;

  readonly currentShift$: Observable<CashShift | null> =
    this.currentShiftSubject.asObservable();

  readonly shiftTotal$: Observable<ShiftTotal> =
    this.shiftTotalSubject.asObservable();

  // ============================================================
  // Смена
  // ============================================================
  getCurrentShift(): Observable<CashShift> {
    return this.http.get<CashShift>(`${this.apiUrl}/kkm/current-shift`)
      .pipe(tap(s => this.currentShiftSubject.next(s)));
  }

  getShiftTotal(): Observable<ShiftTotal> {
    return this.http.get<ShiftTotal>(`${this.apiUrl}/shift-total`)
      .pipe(tap(t => this.shiftTotalSubject.next(t)));
  }

  openShift(): Observable<CashShift> {
    return this.http.post<CashShift>(`${this.apiUrl}/kkm/open-shift`, {})
      .pipe(tap(s => this.currentShiftSubject.next(s)));
  }

  closeShift(): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/kkm/close-shift`, {})
      .pipe(tap(() => this.currentShiftSubject.next(null)));
  }

  xReport(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/kkm/x-report`);
  }

  zReport(): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/kkm/z-report`, {});
  }

  toggleShift(): Observable<CashShift> {
    return this.http.post<CashShift>(`${this.apiUrl}/kkm/toggle-shift`, {})
      .pipe(tap(s => this.currentShiftSubject.next(s)));
  }

  // ============================================================
  // Ручное переключение смены: закрыть → открыть → reload
  // ============================================================
  rotateShiftAndReload(): void {
    this.stopAutoShiftWatch();
    this.closeShift().subscribe({
      next: () => {
        this.openShift().subscribe({
          next: () => window.location.reload(),
          error: err => console.error('[ShiftService] openShift failed:', err),
        });
      },
      error: err => console.error('[ShiftService] closeShift failed:', err),
    });
  }

  // ============================================================
  // Авто-детекция переключения смены на сервере
  // ============================================================
  startAutoShiftWatch(intervalMs = 30_000): void {
    this.stopAutoShiftWatch();

    // первичная синхронизация
    this.http.get<CurrentShiftResponse>(`${this.apiUrl}/kkm/current-shift`).subscribe({
      next: s => {
        if (s?.exists && s.shiftNumber != null) {
          this.lastKnownShiftNumber = s.shiftNumber;
        }
      },
      error: () => { /* ignore */ },
    });

    this.watchTimer = setInterval(() => {
      this.http.get<CurrentShiftResponse>(`${this.apiUrl}/kkm/current-shift`).subscribe({
        next: s => {
          if (!s?.exists || s.shiftNumber == null) return;
          if (this.lastKnownShiftNumber == null) {
            this.lastKnownShiftNumber = s.shiftNumber;
            return;
          }
          if (s.shiftNumber !== this.lastKnownShiftNumber) {
            this.stopAutoShiftWatch();
            // reload - пользователь останется залогинен (JWT в localStorage)
            window.location.reload();
          }
        },
        error: () => { /* network hiccup */ },
      });
    }, intervalMs);
  }

  stopAutoShiftWatch(): void {
    if (this.watchTimer !== null) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  // ============================================================
  // Внешняя синхронизация (MQTT)
  // ============================================================
  setShiftTotal(total: number, count: number): void {
    this.shiftTotalSubject.next({ total, count });
  }

  setCurrentShift(shift: CashShift | null): void {
    this.currentShiftSubject.next(shift);
  }
}