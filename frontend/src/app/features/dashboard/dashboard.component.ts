// src/app/pages/dashboard/dashboard.component.ts
import { Component, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AdminService } from '../../core/services/admin.service';
import { AuthService } from '../../core/services/auth.service';
import { LocalPostService } from '../../core/services/local-post.service';
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
  clientCards: { [key: string]: string } = {};       // NEW: номер карты клиента по постам
  numberOfPosts = 8;
  private subs: Subscription = new Subscription();
  private isBrowser: boolean;

  constructor(
    private admin: AdminService,
    private auth: AuthService,
    private http: HttpClient,
    private localPost: LocalPostService,
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

      // 1. Загрузка статусов постов при старте
      this.http.get('/api/posts').subscribe({
        next: (posts: any) => this.applyPostsSnapshot(posts),
        error: (err) => console.warn('⚠️ Не удалось загрузить статусы постов', err)
      });

      // 2. Периодический опрос (каждые 15 секунд)
      this.subs.add(
        interval(15000).pipe(
          switchMap(() => this.http.get('/api/posts'))
        ).subscribe({
          next: (posts: any) => this.applyPostsSnapshot(posts),
          error: (err) => console.warn('⚠️ Ошибка опроса статусов постов', err)
        })
      );
    }
  }

  // NEW: единая обработка снимка состояния постов + clientCard
  private applyPostsSnapshot(posts: any): void {
    Object.keys(posts).forEach(postId => {
      const state = posts[postId] || {};

      this.localPost.syncFromMqtt(postId, {
        busy: state.busy,
        paused: state.paused,
        balance: state.balance,
        currentProgram: state.currentProgram,
        elapsedSec: state.elapsedSec,
        totalPaid: state.totalPaid,
        receiptCount: state.receiptCount || 0
      });

      // Номер карты клиента, привязанной к посту (приходит с бэкенда,
      // куда он попадает через MQTT-топик posts/{postId}/clientcard)
      if (state.clientCard) {
        this.clientCards[postId] = state.clientCard;
      } else {
        delete this.clientCards[postId];
      }
    });
  }

  getCameraUrl(postId: string): string {
    return this.cameraUrls[postId] || '';
  }

  // NEW: геттер для шаблона
  getClientCard(postId: string): string {
    return this.clientCards[postId] || '';
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
