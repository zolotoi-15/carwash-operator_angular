// src/app/pages/admin/components/dimmers.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';

@Component({
  selector: 'app-dimmers',
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
        <div [formGroupName]="service" class="relay-checkboxes">
          <label *ngFor="let d of dimmerNumbers" class="relay-label">
            <input type="checkbox" [formControlName]="'dimmer' + d" /> {{ d }}
          </label>
        </div>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
    <div *ngIf="!form" class="loading">Загрузка...</div>
  `,
  styles: [`
    .post-selector { margin-bottom: 1rem; }
    .relay-group { margin-bottom: 1rem; border-bottom: 1px solid #eee; padding: 0.5rem; }
    .relay-checkboxes { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.3rem; }
    .relay-label { display: flex; align-items: center; gap: 0.3rem; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 30px; cursor: pointer; }
    .loading { text-align: center; color: #666; }
  `]
})
export class DimmersComponent implements OnInit {
  form!: FormGroup;
  serviceKeys: string[] = [];
  dimmerNumbers = [1, 2, 3, 4];
  selectedPost: number = 1;
  postIds: number[] = [];

  constructor(
    private admin: AdminService,
    private fb: FormBuilder
  ) { }

  ngOnInit() {
    this.admin.getSettings().subscribe(settings => {
      const count = settings.numberOfPosts || 8;
      this.postIds = Array.from({ length: count }, (_, i) => i + 1);
      this.loadPostSettings();
    });
  }

  loadPostSettings() {
    this.admin.getPostSettings(this.selectedPost).subscribe(postSettings => {
      const services = postSettings.services || [];
      this.serviceKeys = services.map(s => s.name);

      const currentMask = postSettings.dimmerMask || {};
      const group: any = {};
      this.serviceKeys.forEach(name => {
        const mask = currentMask[name] || 0;
        const controls: any = {};
        for (let d = 1; d <= 4; d++) {
          controls['dimmer' + d] = [!!(mask & (1 << (d - 1)))];
        }
        group[name] = this.fb.group(controls);
      });
      this.form = this.fb.group(group);
    });
  }

  save() {
    const raw = this.form.value;
    const dimmerMask: any = {};
    this.serviceKeys.forEach(name => {
      const group = raw[name];
      let mask = 0;
      for (let d = 1; d <= 4; d++) {
        if (group['dimmer' + d]) {
          mask |= (1 << (d - 1));
        }
      }
      dimmerMask[name] = mask;
    });
    this.admin.updatePostSettings(this.selectedPost, { dimmerMask }).subscribe(() => {
      alert('Настройки диммеров для поста ' + this.selectedPost + ' сохранены');
    });
  }
}
