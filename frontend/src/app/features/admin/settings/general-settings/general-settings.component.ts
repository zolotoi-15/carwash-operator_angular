import { Component, OnInit, inject } from '@angular/core';

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
  imports: [FormsModule],
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

  /** Массивы для шаблона (реле / диммеры) */
  relayNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
  dimmers = [1, 2, 3, 4];

  /** Какой пост сейчас выбран в UI */
  selectedPostId = 1;

  ngOnInit(): void {
    this.loadSettings();
  }

  // ============================================================
  // Геттер текущего поста — используется в HTML как `ps as current`
  // ============================================================
  get ps(): PostSettings | undefined {
    return this.settings.posts.find(p => p.postId === this.selectedPostId);
  }

  // ============================================================
  // Реакция на смену поста в селекте
  // ============================================================
  onPostChange(postId: number | string): void {
    this.selectedPostId = Number(postId);
  }

  // ============================================================
  // Загрузка
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
      error: (err: any) => {
        console.error('[general-settings] load failed:', err);
        this.notify.error('Не удалось загрузить настройки');
        this.loading = false;
      },
    });
  }

  // ============================================================
  // Сохранение — три публичных метода под три кнопки в HTML
  // ============================================================

  /** Общее сохранение (кнопки «Сохранить» в ККМ, камерах) */
  saveAll(): void {
    this.persist('Настройки сохранены');
  }

  /** Сохранение только MQTT (кнопка в блоке MQTT) */
  saveMqtt(): void {
    this.persist('MQTT-настройки сохранены');
  }

  /** Сохранение настроек выбранного поста (кнопки в блоках постов) */
  savePostSettings(): void {
    if (!this.ps) {
      this.notify.warning('Пост не выбран');
      return;
    }
    this.persist(`Настройки поста ${this.ps.postId} сохранены`);
  }

  /** Единая обёртка — шлёт updateSettings и обновляет состояние */
  private persist(successMessage: string): void {
    this.saving = true;
    this.admin.updateSettings(this.settings).subscribe({
      next: (s) => {
        this.settings = s;
        this.saving = false;
        this.notify.success(successMessage);
      },
      error: (err: any) => {
        console.error('[general-settings] save failed:', err);
        const msg =
          err?.error?.error || err?.error?.message || err?.message || 'Ошибка сохранения';
        this.notify.error(msg);
        this.saving = false;
      },
    });
  }

  // ============================================================
  // Копирование с поста 1 на все остальные
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
    this.persist('Настройки скопированы на все посты');
  }

  // ============================================================
  // Публикация конфига в посты
  // ============================================================
  publishConfig(): void {
    this.admin.publishConfig().subscribe({
      next: () => this.notify.success('Конфиг опубликован во все посты'),
      error: (err: any) => {
        console.error('[general-settings] publishConfig failed:', err);
        this.notify.error('Не удалось опубликовать конфиг');
      },
    });
  }

  // ============================================================
  // MQTT / KKM — геттеры, если понадобятся в шаблоне
  // ============================================================
  get mqtt(): MqttSettings {
    return this.settings.mqtt ?? DEFAULT_MQTT;
  }

  get kkm(): KkmSettings {
    return this.settings.kkm ?? emptyGeneralSettings.kkm;
  }

  // ============================================================
  // Услуги (на случай кнопок «+/-» — сейчас в HTML их нет,
  // но пусть будут, чтобы не терять функциональность)
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
}