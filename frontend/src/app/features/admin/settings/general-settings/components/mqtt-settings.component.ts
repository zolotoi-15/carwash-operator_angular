import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../../../core/services/admin.service';
import { MqttService } from '../../../../../core/services/mqtt.service';

@Component({
  selector: 'app-mqtt-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form *ngIf="form" [formGroup]="form" (ngSubmit)="save()">
      <div class="form-group">
        <label>URL брокера (ws:// или mqtt://):</label>
        <input formControlName="brokerUrl" type="text" placeholder="ws://localhost:8083" />
      </div>
      <div class="form-group">
        <label>Имя пользователя:</label>
        <input formControlName="username" type="text" />
      </div>
      <div class="form-group">
        <label>Пароль:</label>
        <input formControlName="password" type="password" />
      </div>
      <button type="submit" class="save-btn">💾 Сохранить и переподключиться</button>
    </form>
  `,
  styles: [`
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-weight: bold; margin-bottom: 0.3rem; }
    .form-group input { width: 100%; padding: 0.5rem; border-radius: 6px; border: 1px solid #ccc; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 0.5rem 1.5rem; border-radius: 30px; cursor: pointer; }
  `]
})
export class MqttSettingsComponent implements OnInit {
  form!: FormGroup;

  constructor(
    private admin: AdminService,
    private mqtt: MqttService,
    private fb: FormBuilder
  ) {}

  ngOnInit(): void {
    this.admin.getSettings().subscribe(settings => {
      const m = settings.mqtt;
      this.form = this.fb.group({
        brokerUrl: [m?.brokerUrl || `ws://${m?.local?.host || location.hostname}:${m?.local?.portWs || 8083}${m?.local?.path || '/mqtt'}`],
        username: [m?.local?.username || ''],
        password: [m?.local?.password || '']
      });
    });
  }

  save(): void {
    const v = this.form.value;
    this.admin.getSettings().subscribe(settings => {
      const updated = {
        ...settings,
        mqtt: {
          ...settings.mqtt,
          brokerUrl: v.brokerUrl,
          local: {
            ...settings.mqtt.local,
            username: v.username,
            password: v.password
          }
        }
      };
      this.admin.updateSettings(updated).subscribe({
        next: () => {
          this.mqtt.reconnect(v.brokerUrl, v.username, v.password);
          alert('Настройки MQTT сохранены и применены');
        },
        error: () => alert('Ошибка сохранения')
      });
    });
  }
}