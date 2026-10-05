import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';

@Component({
  selector: 'app-cameras',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form *ngIf="form" [formGroup]="form" (ngSubmit)="save()">
      <h3>📷 Настройка камер для постов</h3>
      <p class="info">Введите URL видеопотока (MJPEG, HLS .m3u8 или RTSP-трансляцию, преобразованную в http).</p>
      <div class="cameras-grid">
        <div *ngFor="let i of [1,2,3,4,5,6,7,8]" class="camera-field">
          <label>Пост {{ i }}</label>
          <input type="text" [formControlName]="'cam_' + i" placeholder="http://... или https://..." />
        </div>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
    <div *ngIf="!form" class="loading">Загрузка...</div>
  `,
  styles: [`
    .cameras-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .camera-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .camera-field label {
      font-weight: bold;
    }
    input {
      padding: 6px;
      border-radius: 8px;
      border: 1px solid #ccc;
    }
    .save-btn {
      background: #27ae60;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 30px;
      cursor: pointer;
      font-size: 1rem;
    }
    .info {
      font-size: 0.8rem;
      color: #555;
      margin-bottom: 1rem;
    }
    .loading { text-align: center; color: #666; }
  `]
})
export class CamerasComponent implements OnInit {
  form!: FormGroup;

  constructor(private admin: AdminService, private fb: FormBuilder) { }

  ngOnInit() {
    this.admin.getSettings().subscribe(settings => {
      const group: any = {};
      for (let i = 1; i <= 8; i++) {
        group['cam_' + i] = [settings.cameras?.[i] || ''];
      }
      this.form = this.fb.group(group);
    });
  }

  save() {
    const raw = this.form.value;
    const cameras: any = {};
    for (let i = 1; i <= 8; i++) {
      cameras[i] = raw['cam_' + i] || '';
    }
    this.admin.updateSettings({ cameras }).subscribe(() => alert('Настройки камер сохранены'));
  }
}
