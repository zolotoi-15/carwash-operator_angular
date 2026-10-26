import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

// ✅ CashShift определён в shift.model.ts
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

  /** Номер смены, который видел клиент — для детекции auto-rotation */
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
      .pipe(tap(() => this.currentShiftSubject.next(null)));   // ← сбрасываем UI
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
  /**
   * Фоновый опрос /api/kkm/current-shift.
   * Если shiftNumber изменился — сервер выполнил auto-rotation
   * (closeExpiredShiftIfNeeded). Перезагружаем страницу:
   * после reload APP_INITIALIZER → AuthService.restoreSession()
   * поднимет пользователя из localStorage, повторной аутентификации не будет.
   */
  startAutoShiftWatch(intervalMs = 30_000): void {
    this.stopAutoShiftWatch();

    // Первичная синхронизация — запоминаем текущий номер без reload
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
            console.log(
              `[ShiftService] Auto-rotation detected: ` +
              `${this.lastKnownShiftNumber} → ${s.shiftNumber}. Reloading…`
            );
            this.stopAutoShiftWatch();
            window.location.reload();
          }
        },
        error: () => { /* временный сбой сети — просто пропускаем тик */ },
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