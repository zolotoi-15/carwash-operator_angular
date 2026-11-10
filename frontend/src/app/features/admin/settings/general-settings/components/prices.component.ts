import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';  // <-- добавить
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';

@Component({
  selector: 'app-prices',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],  // <-- добавить FormsModule
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
        <div *ngFor="let service of serviceKeys" class="price-field">
          <label>{{ service }}:
            <input [formControlName]="service" type="number" step="5">
          </label>
        </div>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
    <div *ngIf="!form" class="loading">Загрузка...</div>
  `,
  styles: [/* ... */]
})
export class PricesComponent implements OnInit {
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
      // Загружаем настройки для первого поста
      this.loadPostSettings();
    });
  }

  loadPostSettings() {
    this.admin.getPostSettings(this.selectedPost).subscribe(postSettings => {
      const services = postSettings.services || [];
      this.serviceKeys = services.map(s => s.name);

      const currentPrices = postSettings.prices || {};
      const group: any = {};
      this.serviceKeys.forEach(name => {
        group[name] = [currentPrices[name] || 30];
      });
      this.form = this.fb.group(group);
    });
  }

  save() {
    const prices = this.form.value;
    this.admin.updatePostSettings(this.selectedPost, { prices }).subscribe(() => {
      alert('Цены для поста ' + this.selectedPost + ' сохранены');
    });
  }
}
