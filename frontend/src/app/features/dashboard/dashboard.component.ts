import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService } from '../../core/services/admin.service';
import { RealtimeService, RealtimeMessage } from '../../core/services/realtime.service';
import { NotificationService } from '../../core/services/notification.service';
import { KkmStatusComponent } from './kkm-status/kkm-status.component';
import { TankLevelsComponent } from './tank-levels/tank-levels.component';
import { ShiftTotalComponent } from './shift-total/shift-total.component';
import { PostCardComponent } from './post-card/post-card.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    KkmStatusComponent,
    TankLevelsComponent,
    ShiftTotalComponent,
    PostCardComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  private admin = inject(AdminService);
  private realtime = inject(RealtimeService);
  private notify = inject(NotificationService);

  postIds: number[] = [];
  /** Карта: postId → текущее состояние (приходит из WebSocket snapshot) */
  postsSnapshot: Record<string, any> = {};

  private subs = new Subscription();

  ngOnInit(): void {
    // 1) Список постов — из настроек
    this.admin.getSettings().subscribe(settings => {
      const count = settings.numberOfPosts || 8;
      this.postIds = Array.from({ length: count }, (_, i) => i + 1);
    });

    // 2) Подписка на WebSocket — единый поток для всех клиентов
    this.subs.add(
      this.realtime.messages$.subscribe((msg) => this.handleRealtime(msg)),
    );

    // 3) Индикация статуса соединения
    this.subs.add(
      this.realtime.connected$.subscribe((connected) => {
        if (connected) {
          this.notify.success('Подключено к серверу');
        } else {
          this.notify.warning('Соединение с сервером потеряно');
        }
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private handleRealtime(msg: RealtimeMessage): void {
    if (msg.type === 'snapshot') {
      // Полный снимок состояния при подключении
      this.postsSnapshot = msg.posts || {};
      return;
    }
    if (msg.type === 'mqtt') {
      // Одиночное MQTT-сообщение — обновляем нужный пост
      const topic = msg.topic || '';
      const m = topic.match(/^posts\/(\d+)\/status$/);
      if (!m) return;
      const postId = m[1];
      try {
        const data = JSON.parse(msg.payload || '{}');
        this.postsSnapshot[postId] = { ...(this.postsSnapshot[postId] || {}), ...data };
      } catch { /* ignore */ }
    }
  }
}