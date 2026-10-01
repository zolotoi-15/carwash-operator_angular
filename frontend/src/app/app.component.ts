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
      <a *ngIf="(auth.getRole() | async) === 'admin'" routerLink="/cards">💳 Карты клиентов</a>
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
        // Загружаем цены из настроек первого поста.
        // В новой схеме они лежат внутри settings.posts[1].services[],
        // а settings.posts[1].prices — пустой объект {} (truthy!),
        // поэтому нужно явно предпочесть services, если в prices пусто.
        const postSettings = settings.posts?.[1];
        const services: any[] = postSettings?.services || [];

        // Собираем карту цен: сначала из services, потом поверх — из prices
        const prices: { [key: string]: number } = {};

        // 1) Из массива services (актуальная схема)
        for (const svc of services) {
          if (svc?.name && typeof svc.price === 'number') {
            prices[svc.name] = svc.price;
          }
        }

        // 2) Поверх — старый формат prices (если он есть и не пуст)
        const legacyPrices = postSettings?.prices || settings.prices;
        if (legacyPrices && typeof legacyPrices === 'object') {
          for (const [k, v] of Object.entries(legacyPrices)) {
            if (typeof v === 'number') prices[k] = v;
          }
        }

        const hasPrices = Object.keys(prices).length > 0;

        if (!hasPrices) {
          console.warn(
            '⚠️ Цены не найдены ни в services, ни в prices — ' +
            'локальный fallback не сможет запускать программы'
          );
          return;
        }

        console.log('📦 Цены загружены:', prices);
        this.localPost.updatePrices(prices);

        // Публикуем конфигурацию в MQTT при старте.
        // Ключи water/foam/... — это «машинные» имена, по ним
        // backend и LocalPostService сопоставляют цены с программами.
        const serviceKeys = [
          'water', 'foam', 'wax', 'teflon',
          'osmosis', 'hotWater', 'waterFoam', 'turbo'
        ];
        const mqttServices: ServiceConfig[] = serviceKeys
          .filter(key => prices[key] !== undefined)
          .map(key => ({
            name: this.getServiceName(key),
            price: prices[key]
          }));

        mqttServices.push({
          name: 'Пауза',
          price: settings.pausePrice || 10,
          free_time_sec: settings.pauseFreeTimeSec || 120
        });

        this.mqtt.publishConfig(mqttServices);
        console.log('📤 Конфигурация цен опубликована в MQTT при старте');
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
