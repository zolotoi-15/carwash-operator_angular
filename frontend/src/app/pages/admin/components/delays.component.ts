import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';

@Component({
  selector: 'app-delays',
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
      <div *ngFor="let service of serviceKeys" class="delay-group">
        <strong>{{ service }}</strong>
        <label>On: <input [formControlName]="service + '_on'" type="number" step="10"></label>
        <label>Off: <input [formControlName]="service + '_off'" type="number" step="10"></label>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
    <div *ngIf="!form" class="loading">Загрузка...</div>
  `,
  styles: [`
    .post-selector { margin-bottom: 1rem; }
    .delay-group { display: flex; gap: 1rem; margin-bottom: 0.8rem; border-bottom: 1px solid #eee; padding: 0.5rem; align-items: center; flex-wrap: wrap; }
    .delay-group label { display: flex; gap: 0.5rem; align-items: center; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 30px; cursor: pointer; margin-top: 1rem; }
    .loading { text-align: center; color: #666; }
  `]
})
export class DelaysComponent implements OnInit {
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

      const currentDelays = postSettings.relayDelays || {};
      const group: any = {};
      this.serviceKeys.forEach(name => {
        const def = currentDelays[name] || { onDelay: 100, offDelay: 200 };
        group[name + '_on'] = [def.onDelay];
        group[name + '_off'] = [def.offDelay];
      });
      this.form = this.fb.group(group);
    });
  }

  save() {
    const raw = this.form.value;
    const relayDelays: any = {};
    this.serviceKeys.forEach(name => {
      relayDelays[name] = {
        onDelay: raw[name + '_on'],
        offDelay: raw[name + '_off']
      };
    });
    this.admin.updatePostSettings(this.selectedPost, { relayDelays }).subscribe(() => {
      alert('Задержки для поста ' + this.selectedPost + ' сохранены');
    });
  }
}
