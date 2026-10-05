import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';

@Component({
  selector: 'app-frequencies',
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
        <div *ngFor="let service of serviceKeys" class="freq-field">
          <label>{{ service }}:
            <input [formControlName]="service" type="number" step="1">
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
    .freq-field label { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    input { width: 80px; padding: 6px; border-radius: 8px; border: 1px solid #ccc; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 30px; cursor: pointer; font-size: 1rem; }
    .loading { text-align: center; color: #666; }
  `]
})
export class FrequenciesComponent implements OnInit {
  form!: FormGroup;
  serviceKeys: string[] = [];
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

      const currentFreq = postSettings.vfdFrequencies || {};
      const group: any = {};
      this.serviceKeys.forEach(name => {
        group[name] = [currentFreq[name] || 40];
      });
      this.form = this.fb.group(group);
    });
  }

  save() {
    const vfdFrequencies = this.form.value;
    this.admin.updatePostSettings(this.selectedPost, { vfdFrequencies }).subscribe(() => {
      alert('Частоты для поста ' + this.selectedPost + ' сохранены');
    });
  }
}
