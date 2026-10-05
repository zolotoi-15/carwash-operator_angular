import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, AppSettings, PostSettings, emptyPostSettings } from '../../../../services/admin.service';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings">
      <h1>⚙️ Настройки системы</h1>

      <div *ngIf="loading" class="loading">Загрузка...</div>

      <div *ngIf="!loading && settings" class="tabs">
        <button [class.active]="tab === 'general'" (click)="tab='general'">Общие</button>
        <button [class.active]="tab === 'posts'"   (click)="tab='posts'">Посты</button>
        <button [class.active]="tab === 'mqtt'"    (click)="tab='mqtt'">MQTT</button>
        <button [class.active]="tab === 'kkm'"     (click)="tab='kkm'">ККМ</button>
      </div>

      <!-- ============ ОБЩИЕ ============ -->
      <section *ngIf="!loading && settings && tab === 'general'" class="form">
        <label>Количество постов
          <input type="number" [(ngModel)]="settings.numberOfPosts" name="np" min="1" max="16" />
        </label>
        <label>Цена паузы (₽/мин)
          <input type="number" [(ngModel)]="settings.pausePrice" name="pp" step="0.01" />
        </label>
        <label>Бесплатное время паузы (сек)
          <input type="number" [(ngModel)]="settings.pauseFreeTimeSec" name="pfs" min="0" />
        </label>
        <button class="btn-primary" (click)="save()">💾 Сохранить</button>
      </section>

      <!-- ============ ПОСТЫ ============ -->
      <section *ngIf="!loading && settings && tab === 'posts'" class="form">
        <div class="post-tabs">
          <button *ngFor="let id of postIds"
                  [class.active]="selectedPostId === id"
                  (click)="selectPost(id)">
            Пост {{ id }}
          </button>
        </div>

        <ng-container *ngIf="postSettings as ps">
          <div class="actions-top">
            <button class="btn-secondary" (click)="copyFromPost1()">
              📋 Скопировать с поста 1 во все
            </button>
          </div>

          <!-- Услуги -->
          <h3>Услуги и цены</h3>
          <table class="services-table">
            <thead>
              <tr>
                <th>Услуга</th>
                <th>Цена (₽/мин)</th>
                <th>Бесплатно (сек)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of ps.services; let i = index">
                <td><input [(ngModel)]="s.name" name="sname{{ i }}" /></td>
                <td><input type="number" step="0.01" [(ngModel)]="s.price" name="sprice{{ i }}" /></td>
                <td><input type="number" [(ngModel)]="s.free_time_sec" name="sfree{{ i }}" /></td>
                <td>
                  <button class="icon-btn" (click)="removeService(i)">🗑️</button>
                </td>
              </tr>
              <tr *ngIf="!ps.services.length">
                <td colspan="4" style="text-align:center;color:#94a3b8;padding:16px">
                  Услуги не заданы
                </td>
              </tr>
            </tbody>
          </table>
          <button class="btn-secondary" (click)="addService()">+ Добавить услугу</button>

          <!-- Реле -->
          <h3>Маска реле</h3>
          <div class="grid">
            <label *ngFor="let s of ps.services; let i = index">
              {{ s.name || '—' }} (бит)
              <input type="number"
                     [ngModel]="ps.relayMask?.[s.name]"
                     (ngModelChange)="setMask('relayMask', s.name, $event)"
                     name="relay{{ i }}"
                     min="0" />
            </label>
          </div>

          <!-- Частоты VFD -->
          <h3>Частоты VFD (Гц)</h3>
          <div class="grid">
            <label *ngFor="let s of ps.services; let i = index">
              {{ s.name || '—' }}
              <input type="number"
                     [ngModel]="ps.vfdFrequencies?.[s.name]"
                     (ngModelChange)="setMask('vfdFrequencies', s.name, $event)"
                     name="vfd{{ i }}"
                     min="0" />
            </label>
          </div>

          <!-- Маска диммера -->
          <h3>Маска диммера</h3>
          <div class="grid">
            <label *ngFor="let s of ps.services; let i = index">
              {{ s.name || '—' }}
              <input type="number"
                     [ngModel]="ps.dimmerMask?.[s.name]"
                     (ngModelChange)="setMask('dimmerMask', s.name, $event)"
                     name="dimmer{{ i }}"
                     min="0" />
            </label>
          </div>

          <!-- Кнопочные входы -->
          <h3>Кнопочные входы</h3>
          <div class="grid">
            <label *ngFor="let s of ps.services; let i = index">
              {{ s.name || '—' }}
              <input type="number"
                     [ngModel]="ps.buttonInputs?.[s.name]"
                     (ngModelChange)="setMask('buttonInputs', s.name, $event)"
                     name="btn{{ i }}"
                     min="0" />
            </label>
          </div>

          <!-- Задержки реле -->
          <h3>Задержки реле (мс)</h3>
          <div class="grid delay-grid">
            <div *ngFor="let s of ps.services; let i = index" class="delay-item">
              <div class="delay-label">{{ s.name || '—' }}</div>
              <label>Вкл
                <input type="number"
                       [ngModel]="ps.relayDelays?.[s.name]?.onDelay"
                       (ngModelChange)="setDelay(s.name, 'onDelay', $event)"
                       name="onDelay{{ i }}"
                       min="0" />
              </label>
              <label>Выкл
                <input type="number"
                       [ngModel]="ps.relayDelays?.[s.name]?.offDelay"
                       (ngModelChange)="setDelay(s.name, 'offDelay', $event)"
                       name="offDelay{{ i }}"
                       min="0" />
              </label>
            </div>
          </div>

          <div class="actions-bottom">
            <button class="btn-primary" (click)="savePost()">💾 Сохранить пост {{ selectedPostId }}</button>
          </div>
        </ng-container>
      </section>

      <!-- ============ MQTT ============ -->
      <section *ngIf="!loading && settings && tab === 'mqtt'" class="form">
        <label>Broker URL
          <input [(ngModel)]="settings.mqtt!.brokerUrl" name="mqttUrl" placeholder="wss://..." />
        </label>
        <label>Логин
          <input [(ngModel)]="settings.mqtt!.username" name="mqttUser" />
        </label>
        <label>Пароль
          <input type="password" [(ngModel)]="settings.mqtt!.password" name="mqttPass" />
        </label>
        <button class="btn-primary" (click)="save()">💾 Сохранить</button>
      </section>

      <!-- ============ ККМ ============ -->
      <section *ngIf="!loading && settings && tab === 'kkm'" class="form">
        <label class="checkbox">
          <input type="checkbox" [(ngModel)]="settings.kkm!.enabled" name="kkmEnabled" />
          ККМ включена
        </label>
        <label class="checkbox">
          <input type="checkbox" [(ngModel)]="settings.kkm!.mockReceipt" name="kkmMock" />
          Тестовый режим (без реальной печати)
        </label>
        <label>ФИО кассира
          <input [(ngModel)]="settings.kkmManual!.cashierName" name="cashierName" />
        </label>
        <label>Номер ККМ
          <input [(ngModel)]="settings.kkmManual!.kkNumber" name="kkNumber" />
        </label>
        <button class="btn-primary" (click)="save()">💾 Сохранить</button>
      </section>
    </div>
  `,
  styles: [`
    h1 { color: #1e293b; margin-bottom: 20px; }
    h3 { font-size: 15px; color: #334155; margin: 24px 0 12px; }
    .loading { padding: 24px; color: #64748b; }

    .tabs { display: flex; gap: 4px; margin-bottom: 20px; background: #e2e8f0; padding: 4px; border-radius: 8px; width: fit-content; }
    .tabs button { padding: 8px 20px; background: transparent; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; color: #475569; }
    .tabs button.active { background: #fff; color: #0ea5e9; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

    .post-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
    .post-tabs button { padding: 8px 16px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer; }
    .post-tabs button.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }

    .form { background: #fff; padding: 24px; border-radius: 8px; max-width: 900px; }
    label { display: block; margin-bottom: 12px; font-size: 14px; color: #475569; }
    label input:not([type="checkbox"]), label select { display: block; width: 100%; margin-top: 6px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
    label.checkbox { display: flex; align-items: center; gap: 8px; }
    label.checkbox input { width: auto; margin: 0; }

    .btn-primary { background: #0ea5e9; color: #fff; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; margin-top: 12px; font-size: 15px; }
    .btn-primary:hover { background: #0284c7; }
    .btn-secondary { background: #e2e8f0; color: #1e293b; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin: 8px 0; }
    .btn-secondary:hover { background: #cbd5e1; }
    .icon-btn { background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px 8px; }

    .services-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .services-table th, .services-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .services-table input { width: 100%; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
    .delay-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .delay-item { background: #f8fafc; padding: 10px; border-radius: 6px; }
    .delay-label { font-weight: 600; font-size: 13px; color: #334155; margin-bottom: 6px; }
    .delay-item label { display: inline-block; width: calc(50% - 6px); margin-bottom: 0; margin-right: 8px; font-size: 12px; }
    .delay-item label:nth-child(3) { margin-right: 0; }

    .actions-top, .actions-bottom { display: flex; justify-content: flex-end; margin: 16px 0; }
  `]
})
export class GeneralSettingsComponent implements OnInit {
  private admin = inject(AdminService);
  private notif = inject(NotificationService);

  settings: AppSettings | null = null;
  loading = true;
  tab: 'general' | 'posts' | 'mqtt' | 'kkm' = 'posts';
  selectedPostId = 1;
  postIds: number[] = [];
  postSettings: PostSettings | null = null;

  ngOnInit(): void {
    this.admin.getSettings().subscribe({
      next: s => {
        s.mqtt = s.mqtt ?? { brokerUrl: '', username: '', password: '' };
        s.kkm = s.kkm ?? { enabled: false, mockReceipt: false };
        s.kkmManual = s.kkmManual ?? { cashierName: '', kkNumber: '' };
        s.numberOfPosts = s.numberOfPosts || 8;
        s.posts = s.posts ?? {};

        this.settings = s;
        this.postIds = Array.from({ length: s.numberOfPosts }, (_, i) => i + 1);
        this.loadPost(this.selectedPostId);
        this.loading = false;
      },
      error: () => {
        this.notif.error('Ошибка загрузки настроек');
        this.loading = false;
      }
    });
  }

  selectPost(id: number): void {
    this.selectedPostId = id;
    this.loadPost(id);
  }

private loadPost(id: number): void {
    const raw = this.settings?.posts?.[id];
    if (!raw) {
      this.postSettings = emptyPostSettings();
      return;
    }
    this.postSettings = {
      services: raw.services ? raw.services.map(s => ({ ...s })) : [],
      prices: { ...(raw.prices ?? {}) },
      relayMask: { ...(raw.relayMask ?? {}) },
      vfdFrequencies: { ...(raw.vfdFrequencies ?? {}) },
      dimmerMask: { ...(raw.dimmerMask ?? {}) },
      buttonInputs: { ...(raw.buttonInputs ?? {}) },
      relayDelays: JSON.parse(JSON.stringify(raw.relayDelays ?? {}))
    };
  }

  addService(): void {
    const ps = this.postSettings;
    if (!ps) return;
    ps.services.push({ name: '', price: 0, free_time_sec: 0 });
  }

  removeService(i: number): void {
    const ps = this.postSettings;
    if (!ps) return;
    ps.services.splice(i, 1);
  }

  setMask(
    field: 'relayMask' | 'vfdFrequencies' | 'dimmerMask' | 'buttonInputs',
    key: string,
    value: any
  ): void {
    const ps = this.postSettings;
    if (!ps || !key) return;
    if (!ps[field]) (ps as any)[field] = {};
    (ps as any)[field][key] = Number(value) || 0;
  }

  setDelay(key: string, sub: 'onDelay' | 'offDelay', value: any): void {
    const ps = this.postSettings;
    if (!ps || !key) return;
    if (!ps.relayDelays) ps.relayDelays = {};
    if (!ps.relayDelays[key]) ps.relayDelays[key] = { onDelay: 0, offDelay: 0 };
    ps.relayDelays[key][sub] = Number(value) || 0;
  }

  save(): void {
    const s = this.settings;
    if (!s) return;
    this.admin.updateSettings(s).subscribe({
      next: () => this.notif.success('Настройки сохранены'),
      error: () => this.notif.error('Ошибка сохранения')
    });
  }

  savePost(): void {
    const ps = this.postSettings;
    const s = this.settings;
    if (!ps || !s) return;

    // Автоматически обновляем prices из services
    const prices: { [key: string]: number } = {};
    ps.services.forEach(svc => {
      if (svc.name) prices[svc.name] = Number(svc.price) || 0;
    });
    ps.prices = prices;

    this.admin.updatePostSettings(this.selectedPostId, ps).subscribe({
      next: () => {
        this.notif.success(`Настройки поста ${this.selectedPostId} сохранены`);
        if (!s.posts) s.posts = {};
        s.posts[this.selectedPostId] = { ...ps };
      },
      error: () => this.notif.error('Ошибка сохранения поста')
    });
  }

  copyFromPost1(): void {
    if (!confirm('Скопировать настройки поста 1 во все посты?')) return;
    this.admin.copySettingsFromPost1ToAll().subscribe({
      next: () => {
        this.notif.success('Настройки скопированы');
        this.admin.getSettings().subscribe(s => {
          this.settings = s;
          this.loadPost(this.selectedPostId);
        });
      },
      error: () => this.notif.error('Ошибка копирования')
    });
  }
}