// src/app/features/dashboard/post-card/post-card.component.ts
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LocalPostService } from '../../../core/services/local-post.service';
import { ServiceConfig } from '../../../core/services/mqtt.service';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="post-card" [class.offline]="post?.offlineMode">
      <div class="post-header">
        <span>🚿 Пост {{ postId }}</span>
        <span class="status">{{ post?.offlineMode ? '○ Оффлайн' : '● Онлайн' }}</span>
      </div>
      <div class="balance">💰 Баланс: {{ post?.balance ?? 0 }} ₽</div>
      <div class="services">
        <div *ngFor="let svc of services" class="service-row">
          <span>{{ svc.name }}</span>
          <span>{{ svc.price }} ₽</span>
        </div>
      </div>
      <div class="actions">
        <button>➕ Пополнить</button>
        <button>⏹️ Остановить</button>
        <button>⏸️ Пауза</button>
        <button>🔄 Сброс</button>
        <button>🧾 Печать чека</button>
      </div>
    </div>
  `,
  styles: [`
    .post-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background: #fff; }
    .post-card.offline { opacity: 0.6; }
    .post-header { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 8px; }
    .status { color: #22c55e; font-size: 12px; }
    .offline .status { color: #94a3b8; }
    .balance { margin-bottom: 8px; color: #0f172a; }
    .service-row { display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .actions button { padding: 4px 8px; font-size: 12px; cursor: pointer; }
  `]
})
export class PostCardComponent implements OnInit, OnDestroy {
  @Input() postId!: number;

  post: any = null;
  services: ServiceConfig[] = [];
  private subs = new Subscription();

  constructor(private localPost: LocalPostService) {}

  ngOnInit(): void {
    this.subs.add(
      this.localPost.getPostsObservable().subscribe((list: any[]) => {
        this.post = list.find(p => p.postId === this.postId) ?? null;
      })
    );
    this.subs.add(
      this.localPost.getOfflineModeObservable().subscribe((list: any[]) => {
        const found = list.find(p => p.postId === this.postId);
        if (found) this.post = { ...this.post, ...found };
      })
    );
    this.subs.add(
      this.localPost.getServicesObservable().subscribe((list: ServiceConfig[]) => {
        this.services = list;
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }
}