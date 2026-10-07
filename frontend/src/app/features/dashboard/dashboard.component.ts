import { Component, OnInit, OnDestroy, inject } from '@angular/core';

import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AdminService } from '../../core/services/admin.service';
import { RealtimeService, RealtimeMessage } from '../../core/services/realtime.service';
import { KkmStatusComponent } from './kkm-status/kkm-status.component';
import { TankLevelsComponent } from './tank-levels/tank-levels.component';
import { ShiftTotalComponent } from './shift-total/shift-total.component';
import { PostCardComponent } from './post-card/post-card.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    KkmStatusComponent,
    TankLevelsComponent,
    ShiftTotalComponent,
    PostCardComponent
],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  private admin = inject(AdminService);
  private realtime = inject(RealtimeService);

  postIds: number[] = [];
  private subs = new Subscription();

  ngOnInit(): void {
    // Список постов из настроек
    this.admin.getSettings().subscribe((settings) => {
      const count = settings.numberOfPosts || 8;
      this.postIds = Array.from({ length: count }, (_, i) => i + 1);
    });

    // Подписка на WebSocket — на случай, если дашборд сам будет
    // показывать какие-то общие агрегаты (сейчас — ничего не делает)
    this.subs.add(
      this.realtime.messages$.subscribe((msg: RealtimeMessage) => {
        // no-op: вся логика в PostCardComponent
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }
}