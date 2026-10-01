import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { MqttService } from '../../../services/mqtt.service';

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
        <input formControlName="username" type="text" placeholder="(опционально)" />
      </div>
      <div class="form-group">
        <label>Пароль:</label>
        <input formControlName="password" type="password" placeholder="(опционально)" />
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
  ) { }

  ngOnInit() {
    // Загружаем текущие настройки из админки
    this.admin.getSettings().subscribe(settings => {
      const mqttSettings = settings.mqtt || { brokerUrl: 'ws://' + window.location.hostname + ':8083', username: '', password: '' };
      this.form = this.fb.group({
        brokerUrl: [mqttSettings.brokerUrl || ''],
        username: [mqttSettings.username || ''],
        password: [mqttSettings.password || '']
      });
    });
  }

  save() {
    const mqttSettings = this.form.value;
    // Сохраняем в настройки админки (через /api/settings)
    this.admin.updateSettings({ mqtt: mqttSettings }).subscribe({
      next: () => {
        // Переподключаем MQTT-клиент с новыми параметрами
        this.mqtt.reconnect(mqttSettings.brokerUrl, mqttSettings.username, mqttSettings.password);
        alert('Настройки MQTT сохранены и применены');
      },
      error: (err) => {
        console.error('Ошибка сохранения настроек MQTT', err);
        alert('Ошибка сохранения');
      }
    });
  }
}
