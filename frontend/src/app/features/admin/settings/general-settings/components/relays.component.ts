import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService, RelayInfo } from '../../../../../core/services/admin.service';
import { SettingsUpdateService } from '../../../../../core/services/settings-update.service';
import { RealtimeService } from '../../../../../core/services/realtime.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-relays',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  template: `
    <div class="post-selector">
      <label>Пост:
        <select [(ngModel)]="selectedPost" (change)="loadPostSettings()">
          <option *ngFor="let i of postIds" [value]="i">Пост {{ i }}</option>
        </select>
      </label>
      <button type="button" class="discover-btn" (click)="discoverRelays()">🔍 Поиск реле</button>
    </div>

    <!-- ====== Назначение реле посту ====== -->
    <div class="relay-assignment">
      <h3>📡 Реле (MQTT-топики ретрансляторов)</h3>
      <p>Доступные топики: relay_&lt;MAC&gt;, /postnum, /udp, /status_relay, /active, /ip, /lwt</p>
      <div *ngIf="relaysLoading" class="loading">Загрузка реле...</div>
      <div *ngIf="relaysError" class="error">{{ relaysError }}</div>
      <table *ngIf="!relaysLoading" class="relay-table">
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
          <tr *ngFor="let r of relays">
            <td>{{ r.topic }}</td>
            <td [title]="statusTitle(r)">
              <span [class.online]="online(r)">{{ online(r) ? '● онлайн' : '○ офлайн' }}</span>
            </td>
            <td>{{ r.ip || '—' }}</td>
            <td>{{ r.assignedPost ? 'Пост ' + r.assignedPost : '—' }}</td>
            <td>
              <button
                *ngIf="!r.assignedPost || r.assignedPost !== selectedPost"
                type="button"
                class="assign-btn"
                [disabled]="assignBusy"
                (click)="assignRelay(r.mac)">
                + назначить посту {{ selectedPost }}
              </button>
              <button
                *ngIf="r.assignedPost"
                type="button"
                class="unassign-btn"
                [disabled]="assignBusy"
                (click)="unassignRelay(r)">
                ✖ снять с поста {{ r.assignedPost }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div *ngIf="currentRelayMac" class="assigned-info">
        ✅ Посту {{ selectedPost }} назначено реле: relay_{{ currentRelayMac }}
      </div>
      <div class="manual-assign">
        <h4>MAC вручную, напр. 30:76:F5:30:5B:A4</h4>
        <input type="text" [(ngModel)]="manualMac" placeholder="MAC-адрес" />
        <label>Пост:
          <select [(ngModel)]="manualPost">
            <option *ngFor="let i of postIds" [value]="i">Пост {{ i }}</option>
          </select>
        </label>
        <button
          type="button"
          class="assign-btn"
          [disabled]="assignBusy || !validManualMac"
          (click)="assignManual()">
          + назначить посту {{ manualPost }}
        </button>
      </div>
    </div>

    <!-- ====== Реле и диммеры по услугам ====== -->
    <form *ngIf="form" [formGroup]="form" (ngSubmit)="save()" class="services-config">
      <h3>⚙️ Конфигурация услуг поста {{ selectedPost }}</h3>
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
        <!-- Блок дозации и прокачки -->
        <div class="dosing-section" *ngIf="hasAnyDimmerSelected(service)">
          <div *ngFor="let d of dimmerNumbers" class="dimmer-dosing-row">
            <ng-container *ngIf="form.get(service + '.dimmer' + d)?.value">
              <label>
                D{{ d }} дозация:
                <input
                  type="number"
                  min="0"
                  max="100"
                  [ngModel]="dosingConfig[service][d]"
                  (ngModelChange)="onDosingChange(service, d, $event)"
                  [ngModelOptions]="{standalone: true}" /> %
              </label>
              <button
                type="button"
                class="pump-btn"
                (click)="pumpDimmer(service, d)"
                [disabled]="pumpingDimmer">
                🚿 Прокачать
              </button>
            </ng-container>
          </div>
        </div>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
  `,
  styles: [`
    .post-selector { margin-bottom: 1rem; display: flex; gap: 1rem; align-items: center; }
    .discover-btn { background: #3498db; color: white; border: none; padding: 6px 12px; border-radius: 20px; cursor: pointer; }
    .relay-assignment { border: 1px solid #ddd; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; }
    .relay-table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    .relay-table th, .relay-table td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    .relay-table th { background: #f5f5f5; }
    .online { color: #27ae60; font-weight: bold; }
    .assign-btn { background: #27ae60; color: white; border: none; padding: 4px 10px; border-radius: 15px; cursor: pointer; }
    .unassign-btn { background: #e74c3c; color: white; border: none; padding: 4px 10px; border-radius: 15px; cursor: pointer; }
    .assigned-info { margin-top: 0.5rem; padding: 0.5rem; background: #e8f5e9; border-radius: 4px; }
    .manual-assign { margin-top: 1rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .services-config { border: 1px solid #ddd; padding: 1rem; border-radius: 8px; }
    .relay-group { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #eee; }
    .relay-section { margin-top: 0.5rem; }
    .section-label { font-weight: 600; margin-right: 0.5rem; }
    .relay-checkboxes { display: inline-flex; gap: 0.3rem; flex-wrap: wrap; }
    .relay-label { display: inline-flex; align-items: center; gap: 0.2rem; padding: 2px 6px; background: #f0f0f0; border-radius: 4px; cursor: pointer; }
    .dosing-section { margin-top: 0.5rem; padding: 0.5rem; background: #fff9e6; border-radius: 4px; }
    .dimmer-dosing-row { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.3rem; }
    .pump-btn { background: #9b59b6; color: white; border: none; padding: 4px 10px; border-radius: 15px; cursor: pointer; }
    .pump-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 20px; border-radius: 25px; cursor: pointer; font-weight: bold; }
    .loading { color: #666; text-align: center; padding: 1rem; }
    .error { color: #e74c3c; padding: 0.5rem; background: #ffe6e6; border-radius: 4px; }
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
  dosingConfig: Record<string, Record<number, number>> = {};
  pumpingDimmer = false;
  relays: RelayInfo[] = [];
  relaysLoading = false;
  relaysError = '';
  assignBusy = false;
  currentRelayMac: string | null = null;
  manualMac = '';
  private _manualPost: number | null = null;
  autoRefresh = true;
  private refreshTimer: any = null;

  get manualPost(): number {
    return this._manualPost ?? this.selectedPost;
  }
  set manualPost(v: number) {
    this._manualPost = Number(v);
  }

  get validManualMac(): boolean {
    return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(this.manualMac.trim());
  }

  constructor(
    private admin: AdminService,
    private fb: FormBuilder,
    private settingsUpdate: SettingsUpdateService,
    private realtime: RealtimeService
  ) {}

  ngOnInit(): void {
    this.admin.getSettings().subscribe(s => {
      const count = s.numberOfPosts || 8;
      this.postIds = Array.from({ length: count }, (_, i) => i + 1);
      this.loadPostSettings();
    });
    this.loadRelays();
    this.startAutoRefresh();

    this.realtime.messages$.pipe(takeUntil(this.destroy$)).subscribe((msg: any) => {
      if (msg?.type === 'relay-status' && msg.mac) {
        const mac = String(msg.mac).toUpperCase();
        const r = this.relays.find(x => x.mac === mac);
        if (r && msg.state) {
          if (msg.subTopic === 'lwt') r.online = msg.state.online;
          else r.online = msg.state.online ?? r.online;
          r.ip = msg.state.ip ?? r.ip;
          r.active = msg.state.active ?? r.active;
          r.statusRelay = msg.state.statusRelay ?? r.statusRelay;
          r.lastSeen = msg.state.lastSeen ?? r.lastSeen;
        } else if (!r) {
          this.loadRelays();
        }
      }
      if (msg?.type === 'relay-assigned') this.loadRelays();
    });

    this.settingsUpdate.settingsUpdated$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.loadPostSettings();
      this.loadRelays();
    });
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  startAutoRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (this.autoRefresh && !this.assignBusy && !this.relaysLoading) this.loadRelays();
    }, 10000);
  }

  loadPostSettings(): void {
    this.admin.getPostSettings(this.selectedPost).subscribe(ps => {
      const services = ps.services || [];
      this.serviceKeys = services.filter(s => s.enabled !== false).map(s => s.name);
      this.currentRelayMac = ps.relay?.mac ? String(ps.relay.mac).toUpperCase() : null;

      this.dosingConfig = ps.dimmerDosing ? structuredClone(ps.dimmerDosing) : {};

      const currentMask: Record<string, any> = ps.relayMask || {};
      const currentDimmer: Record<string, any> = ps.dimmerMask || {};

      // ★ ДОЗАЦИЯ-0: инициализация дозации с учётом выбранных диммеров
      this.serviceKeys.forEach(name => {
        if (!this.dosingConfig[name]) this.dosingConfig[name] = {};
        const dimmerValue = Number(currentDimmer[name] || 0);
        for (let d = 1; d <= 4; d++) {
          if (this.dosingConfig[name][d] === undefined) {
            const isDimmerSelected = !!(dimmerValue & (1 << (d - 1)));
            this.dosingConfig[name][d] = isDimmerSelected ? 100 : 0;
          }
        }
      });

      const group: any = {};
      this.serviceKeys.forEach(name => {
        const mask = Number(currentMask[name] || 0);
        const dimmer = Number(currentDimmer[name] || 0);
        const controls: any = {};
        for (let r = 1; r <= 8; r++) controls['relay' + r] = [!!(mask & (1 << (r - 1)))];
        for (let d = 1; d <= 4; d++) controls['dimmer' + d] = [!!(dimmer & (1 << (d - 1)))];
        group[name] = this.fb.group(controls);
      });

      this.form = this.fb.group(group);
    });
  }

  onDosingChange(service: string, dimmer: number, value: number | string): void {
    const num = Number(value) || 0;
    if (!this.dosingConfig[service]) this.dosingConfig[service] = {};
    this.dosingConfig[service][dimmer] = Math.max(0, Math.min(100, num));
  }

  save(): void {
    const raw = this.form.value;
    const relayMask: any = {};
    const dimmerMask: any = {};
    const dimmerDosing: any = {};

    this.serviceKeys.forEach(name => {
      const group = raw[name];
      let mask = 0, dimmer = 0;
      for (let r = 1; r <= 8; r++) if (group['relay' + r]) mask |= (1 << (r - 1));
      for (let d = 1; d <= 4; d++) if (group['dimmer' + d]) dimmer |= (1 << (d - 1));
      relayMask[name] = mask;
      dimmerMask[name] = dimmer;

      // ★ ДОЗАЦИЯ-0: для невыбранных диммеров дозация = 0
      dimmerDosing[name] = {};
      for (let d = 1; d <= 4; d++) {
        const isSelected = !!(dimmer & (1 << (d - 1)));
        dimmerDosing[name][d] = isSelected ? (this.dosingConfig[name]?.[d] ?? 100) : 0;
      }
    });

    this.admin.updatePostSettings(this.selectedPost, { relayMask, dimmerMask, dimmerDosing })
      .subscribe({
        next: () => alert('Настройки реле, диммеров и дозации сохранены'),
        error: (err) => alert('Ошибка сохранения: ' + (err?.error?.error || err?.message))
      });
  }

  hasAnyDimmerSelected(service: string): boolean {
    const group = this.form.get(service);
    if (!group) return false;
    return this.dimmerNumbers.some(d => group.get('dimmer' + d)?.value === true);
  }

  pumpDimmer(service: string, dimmer: number): void {
    if (this.pumpingDimmer) return;
    this.pumpingDimmer = true;
    const percent = this.dosingConfig[service]?.[dimmer] ?? 100;

    this.admin.pumpDimmer(this.selectedPost, `D${dimmer}`, percent).subscribe({
      next: () => {
        this.pumpingDimmer = false;
        alert(`Команда прокачки D${dimmer} (${percent}%) отправлена`);
      },
      error: (err) => {
        this.pumpingDimmer = false;
        alert(`Ошибка прокачки D${dimmer}: ` + (err?.error?.error || err?.message));
      }
    });
  }

  loadRelays(discover = false): void {
    this.relaysLoading = true;
    this.relaysError = '';
    this.admin.getRelays(discover).pipe(takeUntil(this.destroy$)).subscribe({
      next: (list) => { this.relays = list || []; this.relaysLoading = false; },
      error: (err) => {
        this.relaysLoading = false;
        this.relaysError = 'Не удалось получить список реле: ' + (err?.error?.error || err?.message);
      }
    });
  }

  discoverRelays(): void { this.loadRelays(true); }

  online(r: RelayInfo): boolean { return r.online === true; }

  statusTitle(r: RelayInfo): string {
    if (r.online === true) return 'lwt · online';
    if (r.online === false) return 'lwt · offline';
    return 'нет lwt · offline';
  }

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
        alert('Не удалось назначить реле: ' + (err?.error?.error || err?.message));
      }
    });
  }

  unassignRelay(r: RelayInfo): void {
    if (this.assignBusy || !r.assignedPost) return;
    const post = Number(r.assignedPost);
    this.assignBusy = true;
    this.admin.assignPostRelay(post, null).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.assignBusy = false;
        this.selectedPost = post;
        this.currentRelayMac = null;
        this.loadPostSettings();
        this.loadRelays();
      },
      error: (err) => {
        this.assignBusy = false;
        alert('Не удалось снять реле: ' + (err?.error?.error || err?.message));
      }
    });
  }

  assignManual(): void {
    if (!this.validManualMac) return;
    const mac = this.manualMac.trim().toUpperCase();
    const post = Number(this.manualPost);
    this.assignBusy = true;
    this.admin.assignPostRelay(post, mac).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.assignBusy = false;
        this.selectedPost = post;
        this.currentRelayMac = mac;
        this.manualMac = '';
        this.loadPostSettings();
        this.loadRelays();
      },
      error: (err) => {
        this.assignBusy = false;
        alert('Не удалось назначить реле: ' + (err?.error?.error || err?.message));
      }
    });
  }
}