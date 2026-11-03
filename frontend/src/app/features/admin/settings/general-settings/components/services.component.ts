import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, FormArray, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService, ServiceConfig } from '../../../../../core/services/admin.service';
import { SettingsUpdateService } from '../../../../../core/services/settings-update.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-services',
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
      <div formArrayName="services">
        <div *ngFor="let service of services.controls; let i = index" [formGroupName]="i" class="service-row">
          <input formControlName="name" placeholder="Название" class="service-name" />
          <input formControlName="price" type="number" step="1" placeholder="Цена, руб/мин" class="service-price" />
          <input formControlName="free_time_sec" type="number" step="1" placeholder="Беспл. время, сек (опц.)" class="service-free" />
          <label class="enable-label">
            <input type="checkbox" formControlName="enabled" /> Вкл.
          </label>
          <button type="button" (click)="removeService(i)" class="remove-btn">✕</button>
        </div>
      </div>
      <button type="button" (click)="addService()" class="add-btn">➕ Добавить услугу</button>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
  `,
  styles: [`
    .post-selector { margin-bottom: 1rem; }
    .service-row { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; }
    .service-name { flex: 2; min-width: 120px; }
    .service-price { flex: 1; min-width: 80px; }
    .service-free { flex: 1; min-width: 80px; }
    .enable-label { display: flex; align-items: center; gap: 0.3rem; font-size: 0.9rem; }
    .remove-btn { background: #e74c3c; color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; }
    .add-btn { background: #3498db; color: white; border: none; padding: 6px 12px; border-radius: 20px; margin: 0.5rem 0; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 30px; cursor: pointer; }
  `]
})
export class ServicesComponent implements OnInit, OnDestroy {
  form!: FormGroup;
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

  get services(): FormArray {
    return this.form.get('services') as FormArray;
  }

  private createServiceGroup(service?: ServiceConfig): FormGroup {
    return this.fb.group({
      name: [service?.name || '', Validators.required],
      price: [service?.price || 0, [Validators.required, Validators.min(0)]],
      free_time_sec: [service?.free_time_sec ?? null],
      enabled: [service?.enabled !== false]
    });
  }

  loadPostSettings(): void {
    this.admin.getPostSettings(this.selectedPost).subscribe(ps => {
      const services = ps.services || [];
      this.form = this.fb.group({
        services: this.fb.array(services.map(s => this.createServiceGroup(s)))
      });
    });
  }

  addService(): void {
    this.services.push(this.createServiceGroup());
  }

  removeService(index: number): void {
    this.services.removeAt(index);
  }

  save(): void {
    const services = (this.services.value as ServiceConfig[])
      .filter(s => s.name?.trim() !== '');
    this.admin.updatePostSettings(this.selectedPost, { services })
      .subscribe({
        next: () => alert('Услуги для поста ' + this.selectedPost + ' сохранены'),
        error: () => alert('Ошибка сохранения')
      });
  }
}