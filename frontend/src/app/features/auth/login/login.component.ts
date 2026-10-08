import { Component, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
@Component({
  selector: 'app-login', standalone: true, imports: [FormsModule],
  template: `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9">
      <form (ngSubmit)="onSubmit()" style="background:#fff;padding:40px;border-radius:12px;width:360px;box-shadow:0 10px 30px rgba(0,0,0,.08)">
        <h1 style="text-align:center">🚗 CarWash</h1>
        <div style="margin-bottom:16px">
          <label>Имя пользователя</label>
          <input [(ngModel)]="username" name="username" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px" />
        </div>
        <div style="margin-bottom:16px">
          <label>Пароль</label>
          <input [(ngModel)]="password" name="password" type="password" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px" />
        </div>
        @if (error) {
          <p style="color:#ef4444">{{error}}</p>
        }
        <button type="submit" [disabled]="loading" style="width:100%;padding:12px;background:#0ea5e9;color:#fff;border:none;border-radius:6px;cursor:pointer">
          {{ loading ? 'Вход...' : 'Войти' }}
        </button>
      </form>
    </div>`
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private notif = inject(NotificationService);
  username = ''; password = ''; loading = false; error = '';
  onSubmit(): void {
    this.loading = true; this.error = '';
    this.auth.login({ username: this.username, password: this.password }).subscribe({
      next: () => { this.notif.success('Добро пожаловать!'); this.router.navigate(['/dashboard']); },
      error: () => { this.error = 'Неверные данные'; this.loading = false; }
    });
  }
}
