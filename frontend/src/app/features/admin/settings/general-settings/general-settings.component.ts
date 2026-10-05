import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  GeneralSettings,
  PostSettings,
  emptyPostSettings,
  emptyGeneralSettings
} from '../../../../core/services/admin.service';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-page">
      <h2>⚙️ Панель администратора</h2>

      <!-- ============ MQTT ============ -->
      <section class="settings-section">
        <h3>📡 Настройки MQTT</h3>

        <label>
          URL брокера (ws:// или mqtt://):
          <input [(ngModel)]="settings.mqtt.brokerUrl"
                 placeholder="wss://m2.wqtt.ru:13260" />
        </label>

        <label>
          Имя пользователя:
          <input [(ngModel)]="settings.mqtt.username"
                 placeholder="u_XXXXXX" />
        </label>

        <label>
          Пароль:
          <input type="password"
                 [(ngModel)]="settings.mqtt.password"
                 placeholder="••••••••" />
        </label>

        <button (click)="saveMqtt()">💾 Сохранить и переподключиться</button>
      </section>

      <!-- ============ ПОСТЫ: услуги ============ -->
      <section class="settings-section">
        <h3>📋 Услуги</h3>

        <label>
          Пост:
          <select [(ngModel)]="selectedPostId" (ngModelChange)="onPostChange($event)">
            <option *ngFor="let p of settings.posts" [ngValue]="p.postId">
              Пост {{ p.postId }}
            </option>
          </select>
        </label>

        <ng-container *ngIf="ps as currentPs">
          <table class="services-table">
            <thead>
              <tr>
                <th>Услуга</th>
                <th>Цена (руб/мин)</th>
                <th>Беспл. время, сек (опц.)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let svc of currentPs.services; let i = index">
                <td><input [(ngModel)]="svc.name" /></td>
                <td><input type="number" [(ngModel)]="svc.price" /></td>
                <td><input type="number" [(ngModel)]="svc.free_time_sec" /></td>
                <td><button (click)="removeService(i)">✕</button></td>
              </tr>
              <tr *ngIf="!currentPs.services.length">
                <td colspan="4" style="text-align:center; color:#94a3b8">
                  Нет услуг. Нажмите «Добавить услугу».
                </td>
              </tr>
            </tbody>
          </table>

          <button (click)="addService()">➕ Добавить услугу</button>
          <button (click)="savePostSettings()">💾 Сохранить</button>
        </ng-container>
      </section>

      <!-- ============ ОТПРАВКА КОНФИГА ============ -->
      <section class="settings-section">
        <h3>📤 Отправить настройки на посты</h3>
        <p>Опубликовать текущую конфигурацию (услуги, цены, реле и т.д.) в MQTT для всех постов.</p>
        <button (click)="publishToAll()">📤 Отправить настройки</button>
      </section>

      <!-- ============ КОПИРОВАНИЕ ============ -->
      <section class="settings-section">
        <h3>📋 Копировать настройки с поста 1</h3>
        <p>Применить настройки с поста 1 на все остальные посты.</p>
        <button (click)="copyFromFirstToAll()">📋 Копировать</button>
      </section>

      <!-- ============ СОХРАНИТЬ ВСЁ ============ -->
      <button class="save-all" (click)="saveAll()">💾 Сохранить все настройки</button>
    </div>
  `,
  styles: [`
    .settings-page { padding: 24px; }
    .settings-section {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 16px; margin-bottom: 16px;
    }
    .settings-section h3 { margin-top: 0; }
    .settings-section label { display: block; margin-bottom: 8px; }
    .settings-section input, .settings-section select {
      padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px;
      min-width: 240px;
    }
    .services-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    .services-table th, .services-table td {
      padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: left;
    }
    button { margin-right: 8px; padding: 6px 12px; cursor: pointer; }
    .save-all { margin-top: 16px; padding: 10px 20px; font-weight: 600; }
  `]
})
export class GeneralSettingsComponent implements OnInit {
  private admin = inject(AdminService);
  private notify = inject(NotificationService);

  settings: GeneralSettings = { ...emptyGeneralSettings };

  selectedPostId: number | null = null;
  ps: PostSettings | null = null;

  ngOnInit(): void {
    this.loadSettings();
  }

  // ================= LOAD =================

  private loadSettings(): void {
    this.admin.getSettings().subscribe({
      next: (s: GeneralSettings) => {
        this.settings = {
          posts: (s.posts ?? []).map((raw: PostSettings) => ({
            ...emptyPostSettings,
            ...raw,
            services: raw.services ?? []
          })),
          mqtt: s.mqtt ?? { brokerUrl: '', username: '', password: '' },
          kkm: s.kkm ?? emptyGeneralSettings.kkm,
          numberOfPosts: s.numberOfPosts ?? (s.posts?.length ?? 0)
        };

        if (this.settings.posts.length > 0) {
          this.selectedPostId = this.settings.posts[0].postId;
          this.ps = this.clonePs(this.settings.posts[0]);
        }
      },
      error: () => this.notify.error('Не удалось загрузить настройки')
    });
  }

  // ================= MQTT =================

  saveMqtt(): void {
    this.admin.updateSettings(this.settings).subscribe({
      next: () => this.notify.success('Настройки MQTT сохранены'),
      error: () => this.notify.error('Ошибка сохранения MQTT')
    });
  }

  // ================= POST =================

  onPostChange(postId: number): void {
    const found = this.settings.posts.find(p => p.postId === postId);
    if (found) this.ps = this.clonePs(found);
  }

  // ================= SERVICES =================

  addService(): void {
    if (!this.ps) return;
    this.ps.services.push({ name: '', price: 0, free_time_sec: 0 });
  }

  removeService(index: number): void {
    if (!this.ps) return;
    this.ps.services.splice(index, 1);
  }

  // ================= SAVE =================

  savePostSettings(): void {
    if (!this.ps) return;

    const payload: PostSettings = {
      ...this.ps,
      services: this.ps.services ?? []
    };

    this.admin.updatePostSettings(payload.postId, payload).subscribe({
      next: () => {
        const idx = this.settings.posts.findIndex(p => p.postId === payload.postId);
        if (idx >= 0) this.settings.posts[idx] = payload;
        this.notify.success('Настройки поста сохранены');
      },
      error: () => this.notify.error('Ошибка сохранения поста')
    });
  }

  saveAll(): void {
    const payload: GeneralSettings = {
      ...this.settings,
      posts: this.settings.posts.map(p => ({
        ...p,
        services: p.services ?? []
      }))
    };

    this.admin.updateSettings(payload).subscribe({
      next: () => this.notify.success('Настройки сохранены'),
      error: () => this.notify.error('Ошибка сохранения')
    });
  }

  // ================= COPY / PUBLISH =================

  copyFromFirstToAll(): void {
    this.admin.copySettingsFromPost1ToAll().subscribe({
      next: () => {
        this.notify.success('Настройки скопированы во все посты');
        this.loadSettings();
      },
      error: () => this.notify.error('Ошибка копирования')
    });
  }

  publishToAll(): void {
    // Заглушка: реальная публикация в MQTT — через MqttService.publishConfig()
    this.notify.info('Публикация конфига (реализация в MqttService.publishConfig)');
  }

  // ================= HELPERS =================

  private clonePs(ps: PostSettings): PostSettings {
    return {
      ...emptyPostSettings,
      ...ps,
      services: [...(ps.services ?? [])].map(s => ({ ...s }))
    };
  }
}