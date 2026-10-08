import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../../../core/services/admin.service';
import { SettingsUpdateService } from '../../../../../core/services/settings-update.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-buttons',
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
      <div class="two-columns">
        <div *ngFor="let service of serviceKeys" class="button-field">
          <label>{{ service }}:
            <input [formControlName]="service" type="number" min="1" max="32">
          </label>
        </div>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
    <div *ngIf="!form" class="loading">Загрузка...</div>
  `,
  styles: [`
    .post-selector { margin-bottom: 1rem; }
    .two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
    .button-field label { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    input { width: 80px; padding: 6px; border-radius: 8px; border: 1px solid #ccc; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 30px; cursor: pointer; font-size: 1rem; }
    .loading { text-align: center; color: #666; }
  `]
})
export class ButtonsComponent implements OnInit, OnDestroy {
  form!: FormGroup;
  serviceKeys: string[] = [];
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
      const current = ps.buttonInputs || {};
      const group: any = {};
      this.serviceKeys.forEach((name, i) => { group[name] = [current[name] || (i + 1)]; });
      this.form = this.fb.group(group);
    });
  }

  save(): void {
    this.admin.updatePostSettings(this.selectedPost, { buttonInputs: this.form.value })
      .subscribe(() => alert('Назначения кнопок для поста ' + this.selectedPost + ' сохранены'));
  }
}