import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { User } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor() {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
      this.currentUserSubject.next(JSON.parse(stored));
    }
  }

  get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  login(user: User): void {
    localStorage.setItem('currentUser', JSON.stringify(user));
    this.currentUserSubject.next(user);
  }

  logout(): void {
    localStorage.removeItem('currentUser');
    this.currentUserSubject.next(null);
  }

  hasRole(groupName: string): boolean {
    const user = this.currentUserValue;
    if (!user) return false;
    // Здесь должна быть логика получения группы пользователя.
    // Для примера считаем, что groupId соответствует GroupType.
    return user.groupId === this.mapGroupNameToId(groupName);
  }

  private mapGroupNameToId(groupName: string): number {
    // В реальном приложении — запрос к сервису групп
    const map: Record<string, number> = {
      'administrator': 1,
      'developer': 2,
      'operator': 3
    };
    return map[groupName] || 0;
  }
}