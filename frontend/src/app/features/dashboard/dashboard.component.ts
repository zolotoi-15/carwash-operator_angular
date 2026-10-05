import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AdminService, PostSettings, GeneralSettings } from '../../core/services/admin.service';

interface PostCardVm {
  id: number;
  isOnline: boolean;
  services: { name: string; price: number }[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dashboard">
      <p class="welcome" *ngIf="auth.currentUser$() as user">
        Добро пожаловать, <strong>{{ user.fullName }}</strong>!
      </p>

      <h2 class="section-title">🚿 Посты автомойки</h2>

      <div class="posts-grid">
        <div class="post-card" *ngFor="let post of posts" [class.online]="post.isOnline">
          <div class="post-header">
            <span class="post-id">Пост {{ post.id }}</span>
            <span class="post-status" [class.online]="post.isOnline">
              {{ post.isOnline ? '● Онлайн' : '○ Оффлайн' }}
            </span>
          </div>

          <div class="post-services">
            <div *ngFor="let svc of post.services" class="service-row">
              <span class="service-name">{{ svc.name }}</span>
              <span class="service-price">{{ svc.price }} ₽</span>
            </div>
            <div *ngIf="!post.services.length" class="empty">Нет услуг</div>
          </div>

          <a class="post-link"
             [routerLink]="['/admin/settings']"
             [queryParams]="{ post: post.id }">
            Настроить →
          </a>
        </div>

        <div class="empty-state" *ngIf="!posts.length">Посты ещё не настроены</div>
      </div>
    </div>
  `,
  styles: [`
    .dashboard { padding: 24px; }
    .welcome { font-size: 18px; color: #1e293b; margin-bottom: 24px; }
    .section-title { margin: 0 0 16px; color: #334155; }

    .posts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .post-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      transition: box-shadow 0.15s ease;
    }
    .post-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .post-card.online { border-color: #22c55e; }

    .post-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px;
    }
    .post-id { font-weight: 600; font-size: 16px; color: #0f172a; }
    .post-status { font-size: 12px; color: #94a3b8; font-weight: 500; }
    .post-status.online { color: #22c55e; }

    .post-services { flex: 1; margin-bottom: 12px; }
    .service-row {
      display: flex; justify-content: space-between;
      padding: 6px 0; font-size: 14px;
      border-bottom: 1px dashed #e2e8f0;
    }
    .service-row:last-child { border-bottom: none; }
    .service-name { color: #475569; }
    .service-price { color: #0f172a; font-weight: 500; }
    .empty { color: #94a3b8; font-style: italic; padding: 8px 0; }

    .post-link {
      display: inline-block; margin-top: 8px;
      color: #2563eb; text-decoration: none;
      font-weight: 500; font-size: 14px;
    }
    .post-link:hover { text-decoration: underline; }

    .empty-state {
      padding: 32px; text-align: center; color: #94a3b8;
      border: 1px dashed #cbd5e1; border-radius: 10px;
      grid-column: 1 / -1;
    }
  `]
})
export class DashboardComponent implements OnInit {
  auth = inject(AuthService);
  private admin = inject(AdminService);

  posts: PostCardVm[] = [];
  cameraUrls: Record<string, string> = {};

  ngOnInit(): void {
    this.admin.getSettings().subscribe({
      next: (settings: GeneralSettings) => {
        // Карточки постов
        this.posts = (settings.posts ?? []).map((p: PostSettings) => ({
          id: p.postId,
          isOnline: true,   // TODO: подписаться на MQTT-статус
          services: (p.services ?? []).map(s => ({
            name: s.name,
            price: s.price
          }))
        }));

        // Камеры
        if (settings.cameras) {
          this.cameraUrls = settings.cameras;
        }
      },
      error: err => console.error('Ошибка загрузки настроек', err)
    });
  }
}