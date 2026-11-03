import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService, RelayInfo } from '../../../../../core/services/admin.service';
import { SettingsUpdateService } from '../../../../../core/services/settings-update.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-relays',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  template: `
    <!-- ================= Топики реле MQTT-ретрансляторов ================= -->
    <div class="topics-card">
      <div class="topics-header">
        <h4>📡 Реле (MQTT-топики ретрансляторов)</h4>
        <button type="button" class="mini-btn" (click)="discoverRelays()" [disabled]="relaysLoading">
          {{ relaysLoading ? 'Поиск…' : '🔄 Обновить список' }}
        </button>
      </div>
      <p class="hint">
        Доступные топики: <code>relay_&lt;MAC&gt;</code>, <code>/postnum</code>, <code>/udp</code>,
        <code>/status_relay</code>, <code>/active</code>, <code>/ip</code>, <code>/lwt</code>.
        Выберите реле из списка и назначьте его посту. Одно реле — один пост.
      </p>

      <div *ngIf="relaysError" class="error-banner">⚠️ {{ relaysError }}</div>

      <table class="relays-table" *ngIf="relays.length; else noRelays">
        <thead>
          <tr>
            <th>Топик / MAC</th>
            <th>Статус</th>
            <th>IP</th>
            <th>Назначен посту</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let r of relays" [class.row-assigned]="r.assignedPost === selectedPost">
            <td><code>{{ r.topic }}</code></td>
            <td>
              <span class="badge" [ngClass]="online(r) ? 'badge-on' : 'badge-off'">
                {{ online(r) ? '● онлайн' : '○ офлайн' }}
              </span>
            </td>
            <td>{{ r.ip || '—' }}</td>
            <td>
              <span *ngIf="r.assignedPost" class="badge badge-post">Пост {{ r.assignedPost }}</span>
              <span *ngIf="!r.assignedPost" class="muted">свободно</span>
            </td>
            <td>
              <button *ngIf="r.assignedPost !== selectedPost" type="button" class="mini-btn assign"
                      [disabled]="assignBusy || !!r.assignedPost"
                      (click)="assignRelay(r.mac)">
                {{ r.assignedPost ? 'занято' : '→ назначить посту ' + selectedPost }}
              </button>
              <button *ngIf="r.assignedPost === selectedPost" type="button" class="mini-btn unassign"
                      [disabled]="assignBusy" (click)="assignRelay(null)">
                ✖ снять с поста {{ selectedPost }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <ng-template #noRelays>
        <div class="empty">
          {{ relaysLoading ? 'Загрузка реле с брокера…' : 'Реле не обнаружены. Проверьте подключение устройств к MQTT-брокеру и нажмите «Обновить список».' }}
        </div>
      </ng-template>

      <div class="current-assignment" *ngIf="currentRelayMac">
        ✅ Посту <b>{{ selectedPost }}</b> назначено реле: <code>relay_{{ currentRelayMac }}</code>
      </div>
    </div>

    <div class="post-selector">
      <label>Пост: 
        <select [(ngModel)]="selectedPost" (change)="loadPostSettings()">
          <option *ngFor="let i of postIds" [value]="i">Пост {{ i }}</option>
        </select>
      </label>
    </div>
    <form *ngIf="form" [formGroup]="form" (ngSubmit)="save()">
      <div *ngFor="let service of serviceKeys" class="relay-group">
        <strong>{{ service }}</strong>
        <div class="relay-section">
          <span class="section-label">Реле (8 бит):</span>
          <div [formGroupName]="service" class="relay-checkboxes">
            <label *ngFor="let r of relayNumbers" class="relay-label">
              <input type="checkbox" [formControlName]="'relay' + r" /> {{ r }}
            </label>
          </div>
        </div>
        <div class="relay-section">
          <span class="section-label">Диммеры (4 бита):</span>
          <div [formGroupName]="service" class="relay-checkboxes">
            <label *ngFor="let d of dimmerNumbers" class="relay-label">
              <input type="checkbox" [formControlName]="'dimmer' + d" /> D{{ d }}
            </label>
          </div>
        </div>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
    <div *ngIf="!form" class="loading">Загрузка...</div>
  `,
  styles: [`
    .post-selector { margin-bottom: 1rem; }
    .relay-group { margin-bottom: 1.5rem; border-bottom: 1px solid #eee; padding: 0.5rem 0; }
    .relay-section { margin-top: 0.5rem; }
    .section-label { font-size: 0.85rem; color: #555; margin-right: 0.5rem; }
    .relay-checkboxes { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.3rem; }
    .relay-label { display: flex; align-items: center; gap: 0.3rem; font-size: 0.9rem; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 30px; cursor: pointer; margin-top: 1rem; }
    .loading { text-align: center; color: #666; }
    /* --- topics card --- */
    .topics-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem; margin-bottom: 1.25rem; }
    .topics-header { display: flex; justify-content: space-between; align-items: center; }
    .topics-header h4 { margin: 0; font-size: 1rem; color: #0f172a; }
    .hint { font-size: 0.8rem; color: #64748b; margin: 0.35rem 0 0.75rem; line-height: 1.5; }
    .hint code { background: #eef2ff; color: #3730a3; padding: 1px 5px; border-radius: 4px; font-size: 0.75rem; }
    .relays-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .relays-table th { text-align: left; color: #475569; font-weight: 600; padding: 6px 8px; border-bottom: 2px solid #e2e8f0; }
    .relays-table td { padding: 6px 8px; border-bottom: 1px solid #eef2f7; vertical-align: middle; }
    .relays-table code { font-size: 0.78rem; color: #0f172a; }
    .row-assigned { background: #ecfdf5; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge-on { background: #dcfce7; color: #166534; }
    .badge-off { background: #fee2e2; color: #991b1b; }
    .badge-post { background: #dbeafe; color: #1e40af; }
    .muted { color: #94a3b8; font-size: 0.78rem; }
    .mini-btn { border: 1px solid #cbd5e1; background: #fff; color: #334155; padding: 4px 10px; border-radius: 6px; font-size: 0.78rem; cursor: pointer; }
    .mini-btn:hover:not(:disabled) { background: #f1f5f9; }
    .mini-btn:disabled { opacity: 0.55; cursor: default; }
    .mini-btn.assign { border-color: #2563eb; color: #2563eb; }
    .mini-btn.unassign { border-color: #dc2626; color: #dc2626; }
    .error-banner { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; font-size: 0.85rem; margin-bottom: 0.5rem; }
    .empty { padding: 1rem; text-align: center; color: #64748b; font-size: 0.85rem; background: #fff; border: 1px dashed #cbd5e1; border-radius: 8px; }
    .current-assignment { margin-top: 0.75rem; font-size: 0.85rem; color: #166534; }
    .current-assignment code { background: #dcfce7; padding: 1px 6px; border-radius: 4px; }
  `]
})
export class RelaysComponent implements OnInit, OnDestroy {
  form!: FormGroup;
  serviceKeys: string[] = [];
  relayNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
  dimmerNumbers = [1, 2, 3, 4];
  selectedPost = 1;
  postIds: number[] = [];
  private destroy$ = new Subject<void>();

  // ===== Топики реле (relay_<MAC>/...) =====
  relays: RelayInfo[] = [];
  relaysLoading = false;
  relaysError = '';
  assignBusy = false;
  currentRelayMac: string | null = null;

  constructor(
    private admin: AdminService,
    private fb: FormBuilder,
    private settingsUpdate: SettingsUpdateService
  ) {}

  ngOnInit(): void {
    this.admin.getSettings().subscribe(s => {
      const count = s.numberOfPosts || 8;
      this.postIds = Array.from({ length: count }, (_, i) => i + 1);
      this.loadPostSettings();
    });
    this.loadRelays();

    this.settingsUpdate.settingsUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => { this.loadPostSettings(); this.loadRelays(); });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPostSettings(): void {
    this.admin.getPostSettings(this.selectedPost).subscribe(ps => {
      const services = ps.services || [];
      this.serviceKeys = services.filter(s => s.enabled !== false).map(s => s.name);

      // Актуальное назначение реле посту (posts[i].relay.mac)
      this.currentRelayMac = ps.relay?.mac ? String(ps.relay.mac).toUpperCase() : null;

      const currentMask = ps.relayMask || {};
      const currentDimmer = ps.dimmerMask || {};
      const group: any = {};
      this.serviceKeys.forEach(name => {
        const mask = currentMask[name] || 0;
        const dimmer = currentDimmer[name] || 0;
        const controls: any = {};
        for (let r = 1; r <= 8; r++) controls['relay' + r] = [!!(mask & (1 << (r - 1)))];
        for (let d = 1; d <= 4; d++) controls['dimmer' + d] = [!!(dimmer & (1 << (d - 1)))];
        group[name] = this.fb.group(controls);
      });
      this.form = this.fb.group(group);
    });
  }

  save(): void {
    const raw = this.form.value;
    const relayMask: any = {};
    const dimmerMask: any = {};
    this.serviceKeys.forEach(name => {
      const group = raw[name];
      let mask = 0, dimmer = 0;
      for (let r = 1; r <= 8; r++) if (group['relay' + r]) mask |= (1 << (r - 1));
      for (let d = 1; d <= 4; d++) if (group['dimmer' + d]) dimmer |= (1 << (d - 1));
      relayMask[name] = mask;
      dimmerMask[name] = dimmer;
    });
    this.admin.updatePostSettings(this.selectedPost, { relayMask, dimmerMask })
      .subscribe(() => alert('Настройки реле и диммеров для поста ' + this.selectedPost + ' сохранены'));
  }

  // ================= Топики реле (relay_<MAC>/...) =================

  /** Загрузить список реле с брокера */
  loadRelays(discover = false): void {
    this.relaysLoading = true;
    this.relaysError = '';
    this.admin.getRelays(discover).pipe(takeUntil(this.destroy$)).subscribe({
      next: (list) => {
        this.relays = list || [];
        this.relaysLoading = false;
      },
      error: (err) => {
        this.relaysLoading = false;
        this.relaysError = 'Не удалось получить список реле: ' + (err?.error?.error || err?.message || 'ошибка запроса') +
          '. Убедитесь, что бэкенд и MQTT-брокер запущены.';
      }
    });
  }

  /** Принудительное обнаружение реле на брокере */
  discoverRelays(): void {
    this.loadRelays(true);
  }

  /** Статус реле по lwt/active (null — неизвестен, считаем офлайн) */
  online(r: RelayInfo): boolean {
    if (r.online === true) return true;
    const a = r.active;
    if (a === 'online' || a === 1 || a === true || a === '1') return true;
    return false;
  }

  /** Назначить выбранному посту реле (mac = null — снять назначение) */
  assignRelay(mac: string | null): void {
    if (this.assignBusy) return;
    this.assignBusy = true;
    this.admin.assignPostRelay(this.selectedPost, mac).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.assignBusy = false;
        this.currentRelayMac = mac ? String(mac).toUpperCase() : null;
        this.loadRelays();
      },
      error: (err) => {
        this.assignBusy = false;
        const msg = err?.error?.error || err?.message || 'неизвестная ошибка';
        alert('Не удалось назначить реле: ' + msg);
      }
    });
  }
}