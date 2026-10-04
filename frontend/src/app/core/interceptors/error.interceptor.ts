import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { Router } from '@angular/router';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const notif = inject(NotificationService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      // Не трогаем запросы логина — обрабатываются в компоненте
      if (req.url.includes('/auth/login')) {
        return throwError(() => err);
      }
      if (err.status === 401) auth.logout();
      else if (err.status === 403) {
        notif.error('Доступ запрещён');
        router.navigate(['/unauthorized']);
      } else if (err.status >= 500) {
        notif.error('Ошибка сервера');
      }
      return throwError(() => err);
    })
  );
};