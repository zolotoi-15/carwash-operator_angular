// src/app/pages/dashboard/dashboard.component.ts
import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';   // добавить импорт
import { AdminService } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';
import { LocalPostService } from '../../services/local-post.service'; // добавить
import { PostCardComponent } from './post-card.component';
import { KkmStatusComponent } from './kkm-status.component';
import { TankLevelsComponent } from './tank-levels.component';
import { ShiftTotalComponent } from './shift-total.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PostCardComponent,
    KkmStatusComponent,
    TankLevelsComponent,
    ShiftTotalComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  postIds: string[] = [];
  isAdmin = false;
  cameraUrls: { [key: string]: string } = {};
  numberOfPosts = 8;
  private subs: Subscription = new Subscription();
  private isBrowser: boolean;

  constructor(
    private admin: AdminService,
    private auth: AuthService,
    private http: HttpClient,              // добавить
    private localPost: LocalPostService,   // добавить
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit() {
    this.subs.add(this.auth.getRole().subscribe(role => this.isAdmin = role === 'admin'));

    if (this.isBrowser) {
      this.subs.add(
        this.admin.getSettings().subscribe(settings => {
          this.numberOfPosts = settings.numberOfPosts || 8;
          this.postIds = Array.from({ length: this.numberOfPosts }, (_, i) => (i + 1).toString());
          if (settings.cameras) {
            this.cameraUrls = settings.cameras;
          }
        })
      );
      this.subs.add(
        interval(30000).pipe(switchMap(() => this.admin.getSettings())).subscribe(settings => {
          if (settings.cameras) this.cameraUrls = settings.cameras;
        })
      );

      // ===== НОВЫЙ КОД: загрузка статусов постов =====
      // 1. Загрузка при старте
      this.http.get('/api/posts').subscribe({
        next: (posts: any) => {
          Object.keys(posts).forEach(postId => {
            const state = posts[postId];
            this.localPost.syncFromMqtt(postId, {
              busy: state.busy,
              paused: state.paused,
              balance: state.balance,
              currentProgram: state.currentProgram,
              elapsedSec: state.elapsedSec,
              totalPaid: state.totalPaid,
              receiptCount: state.receiptCount || 0
            });
          });
          console.log('✅ Статусы постов загружены с сервера');
        },
        error: (err) => console.warn('⚠️ Не удалось загрузить статусы постов', err)
      });

      // 2. Периодический опрос (каждые 15 секунд)
      this.subs.add(
        interval(15000).pipe(
          switchMap(() => this.http.get('/api/posts'))
        ).subscribe({
          next: (posts: any) => {
            Object.keys(posts).forEach(postId => {
              const state = posts[postId];
              this.localPost.syncFromMqtt(postId, {
                busy: state.busy,
                paused: state.paused,
                balance: state.balance,
                currentProgram: state.currentProgram,
                elapsedSec: state.elapsedSec,
                totalPaid: state.totalPaid,
                receiptCount: state.receiptCount || 0
              });
            });
          },
          error: (err) => console.warn('⚠️ Ошибка опроса статусов постов', err)
        })
      );
      // ===== КОНЕЦ НОВОГО КОДА =====
    }
  }

  getCameraUrl(postId: string): string {
    return this.cameraUrls[postId] || '';
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
