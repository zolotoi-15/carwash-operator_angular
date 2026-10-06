import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './general-settings.component.html',
  styleUrls: ['./general-settings.component.scss'],
})
export class GeneralSettingsComponent implements OnInit {
  private admin = inject(AdminService);
  private notify = inject(NotificationService);

  settings: GeneralSettings = structuredClone(emptyGeneralSettings);
  loading = false;
  saving = false;
  numberOfPostsOptions = [4, 6, 8, 10, 12];

  /** Какой пост сейчас выбран в UI (для табов/селекта) */
  selectedPostId = 1;

  ngOnInit(): void {
    this.loadSettings();
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
        // если выбранный пост исчез — сбросим на первый
        if (!this.settings.posts.find(p => p.postId === this.selectedPostId)) {
          this.selectedPostId = this.settings.posts[0]?.postId ?? 1;
        }
      },
      error: (err) => {
        console.error('[general-settings] load failed:', err);
        this.notify.error('Не удалось загрузить настройки');
        this.loading = false;
      },
    });
  }

  save(): void {
    this.saving = true;
    this.admin.updateSettings(this.settings).subscribe({
      next: (s) => {
        this.settings = s;
        this.notify.success('Настройки сохранены');
        this.saving = false;
      },
      error: (err) => {
        console.error('[general-settings] save failed:', err);
        const msg =
          err?.error?.error || err?.error?.message || err?.message || 'Ошибка сохранения';
        this.notify.error(msg);
        this.saving = false;
      },
    });
  }

  // ============================================================
  // Копирование настроек с поста 1 на остальные
  // ============================================================

  copyFromFirstToAll(): void {
    const post1 = this.settings.posts?.[0];
    if (!post1) {
      this.notify.warning('Пост 1 не найден');
      return;
    }

    const clone = structuredClone(post1);
    const numberOfPosts = this.settings.numberOfPosts || 8;
    const newPosts: PostSettings[] = [];

    for (let i = 1; i <= numberOfPosts; i++) {
      newPosts.push({ ...structuredClone(clone), postId: i });
    }

    this.settings = { ...this.settings, posts: newPosts };

    this.admin.updateSettings(this.settings).subscribe({
      next: (s) => {
        this.settings = s;
        this.notify.success('Настройки скопированы со всех постов');
      },
      error: (err) => {
        console.error('[general-settings] copy failed:', err);
        const msg =
          err?.error?.error || err?.error?.message || err?.message || 'Ошибка копирования';
        this.notify.error(msg);
      },
    });
  }

  // ============================================================
  // Посты
  // ============================================================

  selectPost(postId: number): void {
    this.selectedPostId = postId;
  }

  get selectedPost(): PostSettings | undefined {
    return this.settings.posts.find(p => p.postId === this.selectedPostId);
  }

  addPost(): void {
    const nextId = (this.settings.posts.length || 0) + 1;
    const template = this.settings.posts[0];
    this.settings.posts = [
      ...this.settings.posts,
      template
        ? { ...structuredClone(template), postId: nextId }
        : {
            postId: nextId,
            services: [],
            relayMask: {},
            vfdFrequencies: {},
            dimmerMask: {},
            buttonInputs: {},
            relayDelays: {},
            cameras: {},
          },
    ];
    this.settings.numberOfPosts = this.settings.posts.length;
  }

  removePost(postId: number): void {
    if (this.settings.posts.length <= 1) {
      this.notify.warning('Должен остаться хотя бы один пост');
      return;
    }
    this.settings.posts = this.settings.posts.filter(p => p.postId !== postId);
    this.settings.numberOfPosts = this.settings.posts.length;
    if (this.selectedPostId === postId) {
      this.selectedPostId = this.settings.posts[0].postId;
    }
  }

  onNumberOfPostsChange(n: number): void {
    this.settings.numberOfPosts = n;
    this.syncPostsCount();
  }

  private syncPostsCount(): void {
    const target = this.settings.numberOfPosts;
    const current = this.settings.posts.length;
    if (target === current) return;

    if (target > current) {
      const template = this.settings.posts[0];
      for (let i = current + 1; i <= target; i++) {
        this.settings.posts.push(
          template
            ? { ...structuredClone(template), postId: i }
            : {
                postId: i,
                services: [],
                relayMask: {},
                vfdFrequencies: {},
                dimmerMask: {},
                buttonInputs: {},
                relayDelays: {},
                cameras: {},
              },
        );
      }
    } else {
      this.settings.posts = this.settings.posts.slice(0, target);
      if (!this.settings.posts.find(p => p.postId === this.selectedPostId)) {
        this.selectedPostId = this.settings.posts[0]?.postId ?? 1;
      }
    }
  }

  // ============================================================
  // Услуги
  // ============================================================

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

  // ============================================================
  // MQTT
  // ============================================================

  get mqtt(): MqttSettings {
    return this.settings.mqtt ?? DEFAULT_MQTT;
  }

  set mqtt(v: MqttSettings) {
    this.settings.mqtt = v;
  }

  /** Собрать ws-url из текущих полей и показать (readonly-инпут в шаблоне) */
  get mqttPreviewUrl(): string {
    const m = this.mqtt.local;
    if (!m?.host) return '';
    const port = m.portWs || 8083;
    let path = m.path || '/mqtt';
    if (!path.startsWith('/')) path = '/' + path;
    return `ws://${m.host}:${port}${path}`;
  }

  resetMqttToDefault(): void {
    this.settings.mqtt = structuredClone(DEFAULT_MQTT);
    this.notify.info('MQTT-настройки сброшены на значения по умолчанию');
  }

  // ============================================================
  // ККМ
  // ============================================================

  get kkm(): KkmSettings {
    return this.settings.kkm ?? emptyGeneralSettings.kkm;
  }

  set kkm(v: KkmSettings) {
    this.settings.kkm = v;
  }

  // ============================================================
  // Публикация конфига в посты
  // ============================================================

  publishConfig(): void {
    this.admin.publishConfig().subscribe({
      next: () => this.notify.success('Конфиг опубликован во все посты'),
      error: (err) => {
        console.error('[general-settings] publishConfig failed:', err);
        this.notify.error('Не удалось опубликовать конфиг');
      },
    });
  }
}