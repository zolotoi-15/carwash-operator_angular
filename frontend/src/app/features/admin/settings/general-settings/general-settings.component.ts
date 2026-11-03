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

  numberOfPostsOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

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

  activeServices(post: PostSettings): ServiceConfig[] {
    return (post.services || []).filter(s => s.enabled !== false);
  }

  onPostChange(postId: number | string): void {
    this.selectedPostId = Number(postId);
  }

  // ============================================================
  // Хелперы для «Задержек реле» — безопасный доступ
  // ============================================================
  getDelay(post: PostSettings, name: string, key: 'onDelay' | 'offDelay'): number {
    const def = post.relayDelays?.[name];
    if (!def) return key === 'onDelay' ? 100 : 200;
    return key === 'onDelay' ? (def.onDelay ?? 100) : (def.offDelay ?? 200);
  }

  setDelay(post: PostSettings, name: string, key: 'onDelay' | 'offDelay', value: number): void {
    if (!post.relayDelays) post.relayDelays = {};
    if (!post.relayDelays[name]) post.relayDelays[name] = { onDelay: 100, offDelay: 200 };
    post.relayDelays[name][key] = Number(value) || 0;
  }

  // ============================================================
  // Количество постов
  // ============================================================
  onNumberOfPostsChange(newCount: number | string): void {
    const count = Number(newCount);
    if (!count || count < 1) return;

    const currentPosts = this.settings.posts || [];
    const template = currentPosts.find(p => p.postId === 1) || currentPosts[0];

    if (!template) {
      this.notify.warning('Нет ни одного поста для клонирования');
      return;
    }

    const newPosts: PostSettings[] = [];
    for (let i = 1; i <= count; i++) {
      const existing = currentPosts.find(p => p.postId === i);
      if (existing) {
        newPosts.push(existing);
      } else {
        newPosts.push({
          postId: i,
          services: structuredClone(template.services || []),
          relayMask: {},
          vfdFrequencies: {},
          dimmerMask: {},
          buttonInputs: {},
          relayDelays: {},
          cameras: {},
        });
      }
    }

    this.settings = {
      ...this.settings,
      numberOfPosts: count,
      posts: newPosts,
    };

    if (!newPosts.find(p => p.postId === this.selectedPostId)) {
      this.selectedPostId = 1;
    }

    this.persist(`Количество постов изменено на ${count}`);
  }

  // ============================================================
  // Загрузка / сохранение
  // ============================================================
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

  // ============================================================
  // ★ ДОБАВЛЕНИЕ / УДАЛЕНИЕ УСЛУГ
  // ============================================================

  /** Уникальное имя, не пересекающееся с существующими */
  private nextServiceName(post: PostSettings): string {
    const base = 'Новая услуга';
    if (!post.services.some(s => s.name === base)) return base;
    let i = 2;
    while (post.services.some(s => s.name === `${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  addService(postId: number): void {
    const post = this.settings.posts.find(p => p.postId === postId);
    if (!post) return;

    const name = this.nextServiceName(post);

    // Инициализируем карты, чтобы шаблон не падал
    post.relayMask      = post.relayMask      || {};
    post.vfdFrequencies = post.vfdFrequencies || {};
    post.dimmerMask     = post.dimmerMask     || {};
    post.buttonInputs   = post.buttonInputs   || {};
    post.relayDelays    = post.relayDelays    || {};

    post.relayMask[name]      = 0;
    post.vfdFrequencies[name] = 40;
    post.dimmerMask[name]     = 0;
    post.buttonInputs[name]   = 0;
    post.relayDelays[name]    = { onDelay: 100, offDelay: 200 };

    // ★ Пересобираем массив — Angular гарантированно увидит изменение
    post.services = [
      ...post.services,
      { name, price: 0, free_time_sec: 0, enabled: true } as ServiceConfig,
    ];

    // Форсируем change detection через новую ссылку на массив постов
    this.settings = { ...this.settings, posts: [...this.settings.posts] };
  }

  removeService(postId: number, index: number): void {
    const post = this.settings.posts.find(p => p.postId === postId);
    if (!post) return;
    const svc = post.services[index];
    if (!svc) return;

    const next = [...post.services];
    next.splice(index, 1);
    post.services = next;

    // Чистим карты от удалённой услуги
    if (post.relayMask)      delete post.relayMask[svc.name];
    if (post.vfdFrequencies) delete post.vfdFrequencies[svc.name];
    if (post.dimmerMask)     delete post.dimmerMask[svc.name];
    if (post.buttonInputs)   delete post.buttonInputs[svc.name];
    if (post.relayDelays)    delete post.relayDelays[svc.name];

    this.settings = { ...this.settings, posts: [...this.settings.posts] };
  }
}