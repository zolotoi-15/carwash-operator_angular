import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  GeneralSettings,
  PostSettings,
  ServiceConfig,
  KkmSettings,
  MqttSettings,
  emptyGeneralSettings,
  DEFAULT_MQTT,
} from '../../../../core/services/admin.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { SettingsUpdateService } from '../../../../core/services/settings-update.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './general-settings.component.html',
  styleUrls: ['./general-settings.component.scss'],
})
export class GeneralSettingsComponent implements OnInit, OnDestroy {
  private admin = inject(AdminService);
  private notify = inject(NotificationService);
  private settingsUpdate = inject(SettingsUpdateService);

  settings: GeneralSettings = structuredClone(emptyGeneralSettings);
  loading = false;
  saving = false;

  numberOfPostsOptions = [4, 6, 8, 10, 12];
  relayNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
  dimmers = [1, 2, 3, 4];

  selectedPostId = 1;
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.loadSettings();

    this.settingsUpdate.settingsUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadSettings());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get ps(): PostSettings | undefined {
    return this.settings.posts.find(p => p.postId === this.selectedPostId);
  }

  onPostChange(postId: number | string): void {
    this.selectedPostId = Number(postId);
  }

  loadSettings(): void {
    this.loading = true;
    this.admin.getSettings().subscribe({
      next: (s) => {
        this.settings = s;
        this.loading = false;
        if (!this.settings.posts.find(p => p.postId === this.selectedPostId)) {
          this.selectedPostId = this.settings.posts[0]?.postId ?? 1;
        }
      },
      error: () => {
        this.notify.error('Не удалось загрузить настройки');
        this.loading = false;
      },
    });
  }

  saveAll(): void { this.persist('Настройки сохранены'); }
  saveMqtt(): void { this.persist('MQTT-настройки сохранены'); }

  savePostSettings(): void {
    if (!this.ps) { this.notify.warning('Пост не выбран'); return; }
    this.persist(`Настройки поста ${this.ps.postId} сохранены`);
  }

  private persist(successMessage: string): void {
    this.saving = true;
    this.admin.updateSettings(this.settings).subscribe({
      next: (s) => {
        this.settings = s;
        this.saving = false;
        this.notify.success(successMessage);
      },
      error: (err: any) => {
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Ошибка сохранения';
        this.notify.error(msg);
        this.saving = false;
      },
    });
  }

  copyFromFirstToAll(): void {
    const post1 = this.settings.posts?.[0];
    if (!post1) { this.notify.warning('Пост 1 не найден'); return; }
    const count = this.settings.numberOfPosts || 8;
    const newPosts: PostSettings[] = [];
    for (let i = 1; i <= count; i++) {
      newPosts.push({ ...structuredClone(post1), postId: i });
    }
    this.settings = { ...this.settings, posts: newPosts };
    this.persist('Настройки скопированы на все посты');
  }

  publishConfig(): void {
    this.admin.publishConfig().subscribe({
      next: () => this.notify.success('Конфиг опубликован во все посты'),
      error: () => this.notify.error('Не удалось опубликовать конфиг'),
    });
  }

  get mqtt(): MqttSettings { return this.settings.mqtt ?? DEFAULT_MQTT; }
  get kkm(): KkmSettings { return this.settings.kkm ?? emptyGeneralSettings.kkm; }

  addService(postId: number): void {
    const post = this.settings.posts.find(p => p.postId === postId);
    if (!post) return;
    post.services = [
      ...post.services,
      { name: 'Новая услуга', price: 0, free_time_sec: 0, enabled: true } as ServiceConfig,
    ];
  }

  removeService(postId: number, index: number): void {
    const post = this.settings.posts.find(p => p.postId === postId);
    if (!post) return;
    post.services.splice(index, 1);
  }
}