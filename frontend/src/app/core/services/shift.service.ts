import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

import { CashShift } from '../models/shift.model';

export interface ShiftTotal {
  total: number;
  count: number;
}

@Injectable({ providedIn: 'root' })
export class ShiftService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}`;

  private shiftTotalSubject = new BehaviorSubject<ShiftTotal>({ total: 0, count: 0 });
  private currentShiftSubject = new BehaviorSubject<CashShift | null>(null);

  /** Последний известный номер смены — нужен для детекции авто‑переключения на сервере */
  private lastKnownShiftNumber: number | null = null;
  private autoWatchInterval: ReturnType<typeof setInterval> | null = null;

  readonly currentShift$: Observable<CashShift | null> =
    this.currentShiftSubject.asObservable();

  readonly shiftTotal$: Observable<ShiftTotal> =
    this.shiftTotalSubject.asObservable();

  // ============================================================
  // Смена
  // ============================================================
  getCurrentShift(): Observable<CashShift> {
    return this.http.get<CashShift>(`${this.apiUrl}/kkm/current-shift`)
      .pipe(tap(s => {
        this.currentShiftSubject.next(s);
        const num = (s as any)?.shiftNumber;
        if ((s as any)?.exists && num != null) {
          this.lastKnownShiftNumber = num;
        }
      }));
  }

  getShiftTotal(): Observable<ShiftTotal> {
    return this.http.get<ShiftTotal>(`${this.apiUrl}/shift-total`)
      .pipe(tap(t => this.shiftTotalSubject.next(t)));
  }

  openShift(): Observable<CashShift> {
    return this.http.post<CashShift>(`${this.apiUrl}/kkm/open-shift`, {})
      .pipe(tap(s => {
        this.currentShiftSubject.next(s);
        const num = (s as any)?.shiftNumber;
        if (num != null) this.lastKnownShiftNumber = num;
      }));
  }

  closeShift(): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/kkm/close-shift`, {})
      .pipe(tap(() => this.currentShiftSubject.next(null)));   // ← сбрасываем
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
    this.closeShift()
      .pipe(switchMap(() => this.openShift()))
      .subscribe({
        next: () => {
          // Полная перезагрузка страницы БЕЗ переаутентификации:
          // токен и user лежат в localStorage, AuthService.restoreSession()
          // поднимет их через APP_INITIALIZER до срабатывания гардов.
          window.location.reload();
        },
        error: err => console.error('[ShiftService] rotateShiftAndReload failed:', err),
      });
  }

  // ============================================================
  // Авто‑переключение смены на сервере (closeExpiredShiftIfNeeded)
  // ============================================================
  /**
   * Фоновый опрос сервера. Если номер смены изменился
   * (сервер автозакрыл истёкшую и открыл новую), страница
   * перезагружается — пользователь остаётся залогинен.
   */
  startAutoShiftWatch(intervalMs = 30_000): void {
    this.stopAutoShiftWatch();

    // Первичная синхронизация lastKnownShiftNumber
    this.http.get<any>(`${this.apiUrl}/kkm/current-shift`).subscribe({
      next: s => {
        if (s?.exists && s.shiftNumber != null) {
          this.lastKnownShiftNumber = s.shiftNumber;
        }
      },
      error: () => { /* ignore */ },
    });

    this.autoWatchInterval = setInterval(() => {
      this.http.get<any>(`${this.apiUrl}/kkm/current-shift`).subscribe({
        next: s => {
          const newNum = s?.exists ? s.shiftNumber : null;
          if (newNum == null) return;

          if (this.lastKnownShiftNumber != null && newNum !== this.lastKnownShiftNumber) {
            console.log(
              `[ShiftService] Auto-rotation detected: ${this.lastKnownShiftNumber} → ${newNum}. Reload...`
            );
            this.stopAutoShiftWatch();
            window.location.reload();
          } else if (this.lastKnownShiftNumber == null) {
            this.lastKnownShiftNumber = newNum;
          }
        },
        error: () => { /* ignore transient */ },
      });
    }, intervalMs);
  }

  stopAutoShiftWatch(): void {
    if (this.autoWatchInterval !== null) {
      clearInterval(this.autoWatchInterval);
      this.autoWatchInterval = null;
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
    const num = (shift as any)?.shiftNumber;
    if (num != null) this.lastKnownShiftNumber = num;
  }
}