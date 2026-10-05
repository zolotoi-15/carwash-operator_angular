import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AdminService, GeneralSettings, PostSettings, emptyPostSettings
} from '../../../../core/services/admin.service';
import { MqttService } from '../../../../core/services/mqtt.service';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './general-settings.component.html',
  styleUrls: ['./general-settings.component.scss']
})
export class GeneralSettingsComponent implements OnInit {
  private admin = inject(AdminService);
  private mqtt = inject(MqttService);
  private notify = inject(NotificationService);

  settings: GeneralSettings = {
    posts: [],
    mqtt: { brokerUrl: '', username: '', password: '' },
    kkm: { enabled: false, simulate: false, model: '', fiscalShiftNumber: 0, cashierName: '' },
    numberOfPosts: 8
  };

  selectedPostId: number | null = null;
  ps: PostSettings | null = null;

  readonly relayNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly dimmers = ['D1', 'D2', 'D3', 'D4'];

  ngOnInit(): void {
    this.admin.getSettings().subscribe(s => {
      this.settings = {
        ...s,
        posts: (s.posts ?? []).map(p => ({
          ...emptyPostSettings,
          ...p,
          services: p.services ?? [],
          relayMask: p.relayMask ?? {},
          vfdFrequencies: p.vfdFrequencies ?? {},
          dimmerMask: p.dimmerMask ?? {},
          buttonInputs: p.buttonInputs ?? {},
          relayDelays: p.relayDelays ?? {},
          cameras: p.cameras ?? {}
        }))
      };

      // Гарантируем relayDelays для каждой услуги
      this.settings.posts.forEach(p => {
        p.services.forEach(svc => {
          if (!p.relayDelays[svc.name]) {
            p.relayDelays[svc.name] = { onDelay: 0, offDelay: 0 };
          }
        });
      });

      if (this.settings.posts.length) {
        this.selectedPostId = this.settings.posts[0].postId;
        this.onPostChange(this.selectedPostId);
      }
    });
  }

  onPostChange(postId: number): void {
    const found = this.settings.posts.find(p => p.postId === postId);
    this.ps = found ? { ...found, services: [...found.services] } : null;
  }

  saveMqtt(): void {
    this.admin.updateSettings(this.settings).subscribe(() => {
      this.mqtt.reconnect(
        this.settings.mqtt.brokerUrl,
        this.settings.mqtt.username,
        this.settings.mqtt.password
      );
      this.notify.success('MQTT сохранены, переподключение...');
    });
  }

  savePostSettings(): void {
    if (!this.ps) return;
    this.admin.updatePostSettings(this.ps.postId, this.ps).subscribe(() => {
      const idx = this.settings.posts.findIndex(p => p.postId === this.ps!.postId);
      if (idx >= 0) this.settings.posts[idx] = { ...this.ps! };
      this.notify.success(`Настройки поста ${this.ps!.postId} сохранены`);
    });
  }

  saveAll(): void {
    this.admin.updateSettings(this.settings).subscribe(() => {
      this.notify.success('Настройки сохранены');
    });
  }

  publishConfig(): void {
    const services = this.settings.posts[0]?.services ?? [];
    this.mqtt.publishConfig(services);
    this.notify.success('Конфигурация отправлена');
  }

  copyFromFirstToAll(): void {
    this.admin.copySettingsFromPost1ToAll().subscribe(() => {
      this.notify.success('Настройки скопированы с поста 1');
      this.ngOnInit();
    });
  }

  /** Утилита: массив для *ngFor */
  getServiceNames(): string[] {
    return this.ps?.services.map(s => s.name) ?? [];
  }
}