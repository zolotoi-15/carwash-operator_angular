import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  id: number;
  message: string;
  type: NotificationType;
  timestamp: Date;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private counter = 0;
  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  readonly notifications$: Observable<Notification[]> = this.notificationsSubject.asObservable();

  // ================= PUBLIC API =================

  show(message: string, type: NotificationType = 'info', durationMs = 3000): void {
    const note: Notification = {
      id: ++this.counter,
      message,
      type,
      timestamp: new Date()
    };
    this.notificationsSubject.next([...this.notificationsSubject.value, note]);
    if (durationMs > 0) {
      setTimeout(() => this.dismiss(note.id), durationMs);
    }
  }

  success(message: string): void { this.show(message, 'success'); }
  error(message: string): void   { this.show(message, 'error');   }
  info(message: string): void    { this.show(message, 'info');    }
  warning(message: string): void { this.show(message, 'warning'); }

  dismiss(id: number): void {
    this.notificationsSubject.next(
      this.notificationsSubject.value.filter(n => n.id !== id)
    );
  }

  clear(): void {
    this.notificationsSubject.next([]);
  }
}