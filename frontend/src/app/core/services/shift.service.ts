import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CashShift, ShiftStatus } from '../models/shift.model';

@Injectable({ providedIn: 'root' })
export class ShiftService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/shifts`;

  private currentShiftSubject = new BehaviorSubject<CashShift | null>(null);
  readonly currentShift$ = this.currentShiftSubject.asObservable();

  private shiftsSubject = new BehaviorSubject<CashShift[]>([]);
  readonly shifts$ = this.shiftsSubject.asObservable();

  // MOCK
  private mockShifts: CashShift[] = [
    {
      id: 1,
      status: 'open',
      openedAt: new Date().toISOString(),
      openedBy: 'Оператор',
      totalCash: 10863.10,
      receiptCount: 42
    }
  ];

  constructor() {
    this.loadShifts();
  }

  // ================= READ =================

  getShifts(): Observable<CashShift[]> {
    return of(this.mockShifts);
    // return this.http.get<CashShift[]>(this.apiUrl);
  }

  getCurrentShift(): Observable<CashShift | null> {
    const current = this.mockShifts.find(s => s.status === 'open') ?? null;
    this.currentShiftSubject.next(current);
    return of(current);
    // return this.http.get<CashShift>(`${this.apiUrl}/current`);
  }

  getShift(id: number): Observable<CashShift> {
    const found = this.mockShifts.find(s => s.id === id);
    if (!found) throw new Error(`Смена с id=${id} не найдена`);
    return of(found);
    // return this.http.get<CashShift>(`${this.apiUrl}/${id}`);
  }

  // ================= OPEN / CLOSE =================

  openShift(openedBy: string): Observable<CashShift> {
    const newShift: CashShift = {
      id: Math.max(0, ...this.mockShifts.map(s => s.id)) + 1,
      status: 'open',
      openedAt: new Date().toISOString(),
      openedBy,
      totalCash: 0,
      receiptCount: 0
    };
    this.mockShifts.push(newShift);
    this.shiftsSubject.next([...this.mockShifts]);
    this.currentShiftSubject.next(newShift);
    return of(newShift);
    // return this.http.post<CashShift>(`${this.apiUrl}/open`, { openedBy });
  }

  closeShift(id: number, closedBy: string): Observable<CashShift> {
    const idx = this.mockShifts.findIndex(s => s.id === id);
    if (idx < 0) throw new Error(`Смена с id=${id} не найдена`);

    const closed: CashShift = {
      ...this.mockShifts[idx],
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy
    };
    this.mockShifts[idx] = closed;
    this.shiftsSubject.next([...this.mockShifts]);
    if (this.currentShiftSubject.value?.id === id) {
      this.currentShiftSubject.next(null);
    }
    return of(closed);
    // return this.http.post<CashShift>(`${this.apiUrl}/${id}/close`, { closedBy });
  }

  // ================= AUTO-CLOSE (внутренний) =================

  /**
   * Автоматически закрывает смену и открывает новую.
   * Используется, когда предыдущая смена не была закрыта вручную.
   */
  private autoCloseAndReopen(id: number): void {
    const shift = this.mockShifts.find(s => s.id === id);
    if (!shift || shift.status === 'closed') return;

    shift.status = 'closed';
    shift.closedAt = new Date().toISOString();
    shift.closedBy = 'system (auto)';

    const newShift: CashShift = {
      id: Math.max(0, ...this.mockShifts.map(s => s.id)) + 1,
      status: 'open',
      openedAt: new Date().toISOString(),
      openedBy: 'system (auto)',
      totalCash: 0,
      receiptCount: 0
    };
    this.mockShifts.push(newShift);
    this.shiftsSubject.next([...this.mockShifts]);
    this.currentShiftSubject.next(newShift);
  }

  // ================= LOAD =================

  private loadShifts(): void {
    this.shiftsSubject.next([...this.mockShifts]);
    const current = this.mockShifts.find(s => s.status === 'open') ?? null;
    this.currentShiftSubject.next(current);

    // Автоматически закрываем «зависшие» смены (старше 24 часов)
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.mockShifts
      .filter(s => s.status === 'open' && new Date(s.openedAt).getTime() < dayAgo)
      .forEach(s => this.autoCloseAndReopen(s.id));
  }

  // ================= HELPERS =================

  /** Обновить итоги текущей смены (используется при приёме чека из MQTT) */
  addReceiptToCurrentShift(total: number): void {
    const current = this.currentShiftSubject.value;
    if (!current) return;
    current.totalCash = Math.round((current.totalCash + total) * 100) / 100;
    current.receiptCount += 1;
    this.currentShiftSubject.next({ ...current });
  }

  /** Снимок текущей смены */
  getCurrentShiftSnapshot(): CashShift | null {
    return this.currentShiftSubject.value;
  }
}