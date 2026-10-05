import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PostCardComponent } from './post-card/post-card.component';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, PostCardComponent],
  template: `
    <div class="dashboard">
      <h1>📊 Дашборд</h1>
      <p class="welcome" *ngIf="auth.currentUser$ | async as user">
        Добро пожаловать, <strong>{{ user.fullName }}</strong>!
      </p>

      <div class="posts-grid">
        <app-post-card *ngFor="let id of postIds" [postId]="id"></app-post-card>
      </div>
    </div>
  `,
  styles: [`
    h1 { color: #1e293b; margin-bottom: 8px; }
    .welcome { color: #64748b; margin-bottom: 24px; }
    .posts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
  `]
})
export class DashboardComponent {
  postIds = ['1', '2', '3', '4', '5', '6', '7', '8'];
  constructor(public auth: AuthService) {}
}