<<<<<<< Updated upstream
﻿import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
export interface Notification { id: number; type: 'success'|'error'|'warning'|'info'; message: string; }
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private c = 0;
  private s = new BehaviorSubject<Notification[]>([]);
  public notifications$ = this.s.asObservable();
  success(m: string): void { this.push('success', m); }
  error(m: string): void { this.push('error', m); }
  warning(m: string): void { this.push('warning', m); }
  info(m: string): void { this.push('info', m); }
  private push(t: Notification['type'], m: string): void {
    const id = ++this.c;
    this.s.next([...this.s.value, { id, type: t, message: m }]);
    setTimeout(() => this.s.next(this.s.value.filter(n => n.id !== id)), 4000);
  }
}
=======
@Injectable({ providedIn: 'root' })
export class NotificationService {
  success(message: string): void { }
  error(message: string): void { }
  warning(message: string): void { }
  info(message: string): void { }
}
>>>>>>> Stashed changes
