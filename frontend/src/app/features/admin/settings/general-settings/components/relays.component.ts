import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService,
  GeneralSettings,
  PostSettings,
  ServiceConfig,
} from '../../../../../core/services/admin.service';
import { NotificationService } from '../../../../../core/services/notification.service';
import { SettingsUpdateService } from '../../../../../core/services/settings-update.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-relays',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './relays.component.html',
  styleUrls: ['./relays.component.scss'],
})
export class RelaysComponent implements OnInit, OnDestroy {
  private admin = inject(AdminService);
  private notify = inject(NotificationService);
  private settingsUpdate = inject(SettingsUpdateService);

  selectedPost = 1;
  postIds: number[] = [];
  relayNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
  dimmers = [1, 2, 3, 4];
  services: ServiceConfig[] = [];
  saving = false;

  private post?: PostSettings;
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

  loadPostSettings(): void {
    this.loadSettings();
  }

  private loadSettings(): void {
    this.admin.getSettings().subscribe({
      next: (s: GeneralSettings) => {
        this.postIds = Array.from({ length: s.numberOfPosts || 8 }, (_, i) => i + 1);
        this.post = s.posts.find((p: PostSettings) => p.postId === this.selectedPost);
        this.services = (this.post?.services || []).filter(
          (x: ServiceConfig) => x.enabled !== false,
        );
      },
      error: () => this.notify.error('Не удалось загрузить настройки реле'),
    });
  }

  hasRelayBit(svc: string, bit: number): boolean {
    const mask = Number(this.post?.relayMask?.[svc] ?? 0);
    return (mask & (1 << (bit - 1))) !== 0;
  }

  setRelayBit(svc: string, bit: number, e: Event): void {
    if (!this.post) return;
    this.post.relayMask = this.post.relayMask || {};
    const mask = Number(this.post.relayMask[svc] ?? 0);
    this.post.relayMask[svc] = (e.target as HTMLInputElement).checked
      ? mask | (1 << (bit - 1))
      : mask & ~(1 << (bit - 1));
  }

  hasDimmerBit(svc: string, bit: number): boolean {
    const mask = Number(this.post?.dimmerMask?.[svc] ?? 0);
    return (mask & (1 << (bit - 1))) !== 0;
  }

  setDimmerBit(svc: string, bit: number, e: Event): void {
    if (!this.post) return;
    this.post.dimmerMask = this.post.dimmerMask || {};
    const mask = Number(this.post.dimmerMask[svc] ?? 0);
    this.post.dimmerMask[svc] = (e.target as HTMLInputElement).checked
      ? mask | (1 << (bit - 1))
      : mask & ~(1 << (bit - 1));
  }

  /** Только сохранить настройки в базу */
  save(): void {
    if (!this.post) { this.notify.warning('Пост не выбран'); return; }
    this.saving = true;
    this.admin.getSettings().subscribe({
      next: (s: GeneralSettings) => {
        const target = s.posts.find((p: PostSettings) => p.postId === this.selectedPost);
        if (target && this.post) {
          target.relayMask = { ...(this.post.relayMask || {}) };
          target.dimmerMask = { ...(this.post.dimmerMask || {}) };
        }
        this.admin.updateSettings(s).subscribe({
          next: () => {
            this.saving = false;
            this.notify.success(`Настройки поста ${this.selectedPost} сохранены`);
            this.loadSettings();
          },
          error: () => {
            this.saving = false;
            this.notify.error('Ошибка сохранения настроек');
          },
        });
      },
      error: () => {
        this.saving = false;
        this.notify.error('Не удалось загрузить настройки');
      },
    });
  }

  /** Сохранить и сразу отправить в MQTT только для этого поста */
  publishPost(): void {
    if (!this.post) { this.notify.warning('Пост не выбран'); return; }
    this.saving = true;
    this.admin.getSettings().subscribe({
      next: (s: GeneralSettings) => {
        const target = s.posts.find((p: PostSettings) => p.postId === this.selectedPost);
        if (target && this.post) {
          target.relayMask = { ...(this.post.relayMask || {}) };
          target.dimmerMask = { ...(this.post.dimmerMask || {}) };
        }
        // 1. Сохраняем в базу
        this.admin.updateSettings(s).subscribe({
          next: () => {
            // 2. Публикуем в MQTT только этот пост
            this.admin.publishPostConfig(this.selectedPost).subscribe({
              next: () => {
                this.saving = false;
                this.notify.success(`Пост ${this.selectedPost} отправлен в MQTT`);
                this.loadSettings();
              },
              error: () => {
                this.saving = false;
                this.notify.error(`Ошибка отправки поста ${this.selectedPost} в MQTT`);
              },
            });
          },
          error: () => {
            this.saving = false;
            this.notify.error('Ошибка сохранения перед отправкой');
          },
        });
      },
      error: () => {
        this.saving = false;
        this.notify.error('Не удалось загрузить настройки');
      },
    });
  }
}