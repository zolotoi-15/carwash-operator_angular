import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="app-header">
      <div class="user-info" *ngIf="auth.currentUser$() as u">
        <div class="user-name">{{ u.fullName }}</div>
        <div class="user-group">{{ u.group?.displayName }}</div>
      </div>
      <button class="logout-btn" (click)="auth.logout()">Выйти</button>
    </header>
  `,
  styles: [`
    .app-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px;
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
    }
    .user-info { text-align: right; }
    .user-name { font-weight: 600; }
    .user-group { font-size: 12px; color: #64748b; }
    .logout-btn {
      padding: 6px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #f8fafc;
      cursor: pointer;
    }
  `]
})
export class HeaderComponent {
  auth = inject(AuthService);
}