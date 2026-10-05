import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="post-card" [class.online]="isOnline">
      <div class="post-header">
        <span class="post-id">Пост {{ postId }}</span>
        <span class="post-status" [class.online]="isOnline">
          {{ isOnline ? '● Онлайн' : '○ Оффлайн' }}
        </span>
      </div>
      <div class="post-services">
        <div *ngFor="let svc of services" class="service-row">
          <span>{{ svc.name }}</span>
          <span>{{ svc.price }} ₽</span>
        </div>
        <div *ngIf="!services.length" class="empty">Нет услуг</div>
      </div>
      <a class="post-link" [routerLink]="['/admin/settings']" [queryParams]="{ post: postId }">
        Настроить →
      </a>
    </div>
  `,
  styles: [/* те же стили .post-card из dashboard */]
})
export class PostCardComponent {
  @Input() postId!: number;
  @Input() isOnline = false;
  @Input() services: { name: string; price: number }[] = [];
}