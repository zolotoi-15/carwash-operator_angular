import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService, PostSettings } from '../../core/services/admin.service';
import { RealtimeService, RealtimeMessage } from '../../core/services/realtime.service';
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

  postIds: number[] = [];

  /** Для каждого поста — список активных услуг: { postId: [{name, price, ...}] } */
  activeServicesByPost: Record<number, { name: string; price: number; free_time_sec: number }[]> = {};

  private subs = new Subscription();

  ngOnInit(): void {
    this.loadSettings();

    this.subs.add(
      this.realtime.messages$.subscribe((msg: RealtimeMessage) => {
        // no-op
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private loadSettings(): void {
    this.admin.getSettings().subscribe((settings) => {
      const count = settings.numberOfPosts || 8;
      this.postIds = Array.from({ length: count }, (_, i) => i + 1);

      // Собираем активные услуги по каждому посту
      const map: Record<number, { name: string; price: number; free_time_sec: number }[]> = {};
      for (const post of settings.posts) {
        map[post.postId] = (post.services || [])
          .filter(s => s.enabled !== false)
          .map(s => ({
            name: s.name,
            price: s.price,
            free_time_sec: s.free_time_sec ?? 0,
          }));
      }
      this.activeServicesByPost = map;
    });
  }
}