import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, GeneralSettings, PostSettings, emptyPostSettings } from '../../../../core/services/admin.service';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-page">
      <h2>Общие настройки</h2>

      <!-- ============ ОБЩИЕ ============ -->
      <section class="settings-section">
        <h3>MQTT</h3>
        <label>
          Хост:
          <input [(ngModel)]="settings.mqtt.host" />
        </label>
        <label>
          Порт:
          <input type="number" [(ngModel)]="settings.mqtt.port" />
        </label>
      </section>

      <!-- ============ ПОСТЫ ============ -->
      <section class="settings-section">
        <h3>Посты</h3>

        <label>
          Выберите пост:
          <select [(ngModel)]="selectedPostId" (ngModelChange)="onPostChange($event)">
            <option *ngFor="let p of settings.posts" [ngValue]="p.postId">
              Пост {{ p.postId }}
            </option>
          </select>
        </label>

        <ng-container *ngIf="ps as currentPs">
          <h4>Услуги поста {{ currentPs.postId }}</h4>

          <table class="services-table">
            <thead>
              <tr>
                <th>Услуга</th>
                <th>Цена</th>
                <th>Свободное время (сек)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let svc of currentPs.services; let i = index">
                <td><input [(ngModel)]="svc.name" /></td>
                <td><input type="number" [(ngModel)]="svc.price" /></td>
                <td><input type="number" [(ngModel)]="svc.free_time_sec" /></td>
                <td>
                  <button (click)="removeService(i)">Удалить</button>
                </td>
              </tr>
              <tr *ngIf="!currentPs.services.length">
                <td colspan="4" style="text-align:center; color:#94a3b8">
                  Нет услуг. Нажмите «Добавить услугу».
                </td>
              </tr>
            </tbody>
          </table>

          <button (click)="addService()">➕ Добавить услугу</button>
          <button (click)="savePostSettings()">💾 Сохранить пост</button>
        </ng-container>

        <button (click)="copyFromFirstToAll()">
          📋 Скопировать настройки поста 1 во все посты
        </button>
      </section>

      <!-- ============ MQTT (пример другого блока) ============ -->
      <!-- при необходимости добавьте свои разделы -->

      <!-- ============ KKM ============ -->
      <section class="settings-section">
        <h3>ККМ</h3>
        <label>
          Включена:
          <input type="checkbox" [(ngModel)]="settings.kkm.enabled" />
        </label>
        <label>
          Модель:
          <input [(ngModel)]="settings.kkm.model" />
        </label>
      </section>

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
  settings: GeneralSettings = {
    posts: [],
    mqtt: { host: '', port: 1883 },
    kkm: { enabled: false, model: '' }
  };

  selectedPostId: number | null = null;
  ps: PostSettings | null = null;

  constructor(
    private admin: AdminService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadSettings();
  }

  // ================= LOAD =================

  private loadSettings(): void {
    this.admin.getSettings().subscribe({
      next: (s: GeneralSettings) => {
        this.settings = {
          posts: (s.posts ?? []).map((raw: PostSettings) => ({
            ...raw,
            services: raw.services ?? []   // 👈 защита от null/undefined
          })),
          mqtt: s.mqtt ?? { host: '', port: 1883 },
          kkm: s.kkm ?? { enabled: false, model: '' }
        };

        if (this.settings.posts.length > 0) {
          this.selectedPostId = this.settings.posts[0].postId;
          this.ps = { ...this.settings.posts[0], services: [...this.settings.posts[0].services] };
        }
      },
      error: () => this.notify.error('Не удалось загрузить настройки')
    });
  }

  // ================= POST =================

  onPostChange(postId: number): void {
    const found = this.settings.posts.find(p => p.postId === postId);
    if (found) {
      this.ps = { ...found, services: [...found.services] };
    }
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

    // Защита: убеждаемся, что services — массив
    const payload: PostSettings = {
      ...this.ps,
      services: this.ps.services ?? []
    };

    this.admin.updatePostSettings(payload.postId, payload).subscribe({
      next: () => {
        // обновляем локальный массив
        const idx = this.settings.posts.findIndex(p => p.postId === payload.postId);
        if (idx >= 0) this.settings.posts[idx] = payload;
        this.notify.success('Настройки поста сохранены');
      },
      error: () => this.notify.error('Ошибка сохранения поста')
    });
  }

  copyFromFirstToAll(): void {
    this.admin.copySettingsFromPost1ToAll().subscribe({
      next: () => {
        this.notify.success('Настройки скопированы во все посты');
        this.loadSettings();
      },
      error: () => this.notify.error('Ошибка копирования')
    });
  }

  saveAll(): void {
    // Приводим services к массиву на всякий случай
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
}