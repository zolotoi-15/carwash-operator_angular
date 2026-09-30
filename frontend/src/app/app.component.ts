import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AdminService } from './services/admin.service';
import { MqttService, ServiceConfig } from './services/mqtt.service';
import { LocalPostService } from './services/local-post.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <nav *ngIf="(auth.isAuthenticated() | async)">
      <a routerLink="/dashboard">📊 Дашборд</a>
      <a *ngIf="(auth.getRole() | async) === 'admin'" routerLink="/admin">⚙️ Админка</a>
      <a *ngIf="(auth.getRole() | async) === 'admin'" routerLink="/reports">📄 Отчёты</a>
      <button (click)="logout()">🚪 Выйти</button>
    </nav>
    <main>
      <router-outlet></router-outlet>
    </main>
  `,
  styles: [`
    nav { background: #2c3e50; padding: 1rem 2rem; display: flex; gap: 1.5rem; align-items: center; }
    nav a, nav button { color: white; text-decoration: none; font-weight: 500; background: none; border: none; font-size: 1rem; cursor: pointer; }
    nav a:hover, nav button:hover { text-decoration: underline; }
    main { padding: 1rem; }
  `]
})
export class AppComponent implements OnInit {
  constructor(
    private admin: AdminService,
    private mqtt: MqttService,
    private localPost: LocalPostService,
    public auth: AuthService,
    private router: Router
  ) { }

  ngOnInit() {
    this.admin.getSettings().subscribe({
      next: (settings) => {
        // Загружаем цены из настроек первого поста (если есть)
        // или из глобальных полей для обратной совместимости
        const postSettings = settings.posts?.[1];
        const prices = postSettings?.prices || settings.prices;

        if (prices) {
          this.localPost.updatePrices(prices);

          const serviceKeys = ['water', 'foam', 'wax', 'teflon', 'osmosis', 'hotWater', 'waterFoam', 'turbo'];
          const services: ServiceConfig[] = serviceKeys.map(key => ({
            name: this.getServiceName(key),
            price: prices[key]
          }));
          services.push({
            name: 'Пауза',
            price: settings.pausePrice || 10,
            free_time_sec: settings.pauseFreeTimeSec || 120
          });

          this.mqtt.publishConfig(services);
          console.log('📤 Конфигурация цен опубликована в MQTT при старте');
        }
      },
      error: (err) => {
        console.warn('Не удалось загрузить настройки при старте:', err);
      }
    });
  }

  private getServiceName(key: string): string {
    const map: { [key: string]: string } = {
      water: 'Вода',
      foam: 'Пена',
      wax: 'Воск',
      teflon: 'Тефлон',
      osmosis: 'Осмос',
      hotWater: 'Горячая вода',
      waterFoam: 'Вода+Пена',
      turbo: 'Турбо мойка'
    };
    return map[key] || key;
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
