import {
  ApplicationConfig,
  provideZoneChangeDetection,
  importProvidersFrom
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Зоновая детекция с объединением событий — стандарт для Angular 17+
    provideZoneChangeDetection({ eventCoalescing: true }),

    // Роутинг + привязка параметров маршрута к @Input() компонентов
    provideRouter(routes, withComponentInputBinding()),

    // HTTP-клиент с интерсепторами.
    // ВАЖНО: provideHttpClient вызывается РОВНО ОДИН РАЗ.
    provideHttpClient(
      withInterceptors([authInterceptor, errorInterceptor])
    ),

    // Анимации (нужны для Material и для transition-ов)
    importProvidersFrom(BrowserAnimationsModule)

    // ❌ JwtModule.forRoot(...) — НЕ добавлять, AuthService больше не использует JwtHelperService
  ]
};