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

@Injectable({ providedIn: 'root' })
export class ShiftService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}`;

  private shiftTotalSubject = new BehaviorSubject<ShiftTotal>({ total: 0, count: 0 });
  private currentShiftSubject = new BehaviorSubject<CashShift | null>(null);

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
    return this.http.post<any>(`${this.apiUrl}/kkm/close-shift`, {});
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
  // Внешняя синхронизация (MQTT)
  // ============================================================
  setShiftTotal(total: number, count: number): void {
    this.shiftTotalSubject.next({ total, count });
  }

  setCurrentShift(shift: CashShift | null): void {
    this.currentShiftSubject.next(shift);
  }
}