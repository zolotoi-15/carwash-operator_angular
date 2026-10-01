import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, tap } from 'rxjs';
import { CashShift } from '../models/shift.model';

const HOURS_24 = 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class ShiftService implements OnDestroy {
  private readonly apiUrl = '/api/shifts';
  private autoCloseTimer?: ReturnType<typeof setTimeout>;

  private currentShiftSubject = new BehaviorSubject<CashShift | null>(null);
  currentShift$ = this.currentShiftSubject.asObservable();

  constructor(private http: HttpClient) {}

  /** Получить текущую открытую смену */
  getCurrentShift(): Observable<CashShift | null> {
    return this.http
      .get<CashShift | null>(`${this.apiUrl}/current`)
      .pipe(tap((shift) => this.currentShiftSubject.next(shift)));
  }

  /** Ручное открытие смены */
  openShift(userId: string, openingBalance = 0): Observable<CashShift> {
    return this.http
      .post<CashShift>(`${this.apiUrl}/open`, { userId, openingBalance })
      .pipe(
        tap((shift) => {
          this.currentShiftSubject.next(shift);
          this.startAutoClose(shift);
        }),
      );
  }

  /** Ручное закрытие смены */
  closeShift(shiftId: string, userId: string, closingBalance = 0): Observable<CashShift> {
    return this.http
      .post<CashShift>(`${this.apiUrl}/close`, {
        shiftId,
        userId,
        closingBalance,
      })
      .pipe(
        tap(() => {
          this.stopAutoClose();
          this.currentShiftSubject.next(null);
        }),
      );
  }

  /** Запуск таймера авто-закрытия через 24 часа с момента открытия */
  startAutoClose(shift: CashShift): void {
    this.stopAutoClose();
    if (!shift.openedAt) return;

    const openedAt = new Date(shift.openedAt).getTime();
    const elapsed = Date.now() - openedAt;
    const remaining = HOURS_24 - elapsed;

    if (remaining <= 0) {
      this.autoCloseAndReopen(shift._id!);
    } else {
      this.autoCloseTimer = setTimeout(
        () => this.autoCloseAndReopen(shift._id!),
        remaining,
      );
    }
  }

  stopAutoClose(): void {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = undefined;
    }
  }

  private autoCloseAndReopen(shiftId: string): void {
    this.http
      .post<CashShift>(`${this.apiUrl}/close`, {
        shiftId,
        userId: 'system',
        auto: true,
      })
      .subscribe({
        next: () => {
          this.currentShiftSubject.next(null);
          // Открываем новую смену автоматически
          this.openShift('system').subscribe({
            next: (newShift) => this.currentShiftSubject.next(newShift),
            error: (e) => console.error('[Shift] auto-open failed', e),
          });
        },
        error: (e) => console.error('[Shift] auto-close failed', e),
      });
  }

  ngOnDestroy(): void {
    this.stopAutoClose();
  }
}
