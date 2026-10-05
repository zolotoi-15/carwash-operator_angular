import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dashboard">
      <p class="welcome" *ngIf="auth.currentUser$() as user">
        Добро пожаловать, <strong>{{ user.fullName }}</strong>!
      </p>
      <p *ngIf="!auth.currentUser$()">Пожалуйста, войдите в систему.</p>
    </div>
  `,
  styles: [`
    .dashboard { padding: 24px; }
    .welcome { font-size: 18px; color: #1e293b; }
  `]
})
export class DashboardComponent {
  auth = inject(AuthService);
}