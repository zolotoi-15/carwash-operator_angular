import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../../../core/services/admin.service';
import { SettingsUpdateService } from '../../../../../core/services/settings-update.service';
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

    this.settingsUpdate.settingsUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadPostSettings());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPostSettings(): void {
    this.admin.getPostSettings(this.selectedPost).subscribe(ps => {
      const services = ps.services || [];
      this.serviceKeys = services.filter(s => s.enabled !== false).map(s => s.name);

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
}