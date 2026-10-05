import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const notify = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let message = 'Произошла ошибка';

      if (error.status === 401) {
        auth.logout();
        router.navigate(['/login']);
        message = 'Сессия истекла. Войдите заново.';
      } else if (error.status === 403) {
        message = 'У вас нет прав для этого действия.';
      } else if (error.status === 0) {
        message = 'Сервер недоступен. Проверьте соединение.';
      } else if (error.error?.message) {
        message = error.error.message;
      }

      notify.error(message);
      return throwError(() => error);
    })
  );
};