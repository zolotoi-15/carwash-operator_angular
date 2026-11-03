import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
@Component({
  selector: 'app-unauthorized', standalone: true, imports: [RouterModule],
  template: `<div style="text-align:center;padding:60px 20px">
    <h1 style="color:#ef4444">🚫 Доступ запрещён</h1>
    <p>У вас нет прав для просмотра этой страницы.</p>
    <a routerLink="/dashboard" style="color:#0ea5e9">← На дашборд</a>
  </div>`
})
export class UnauthorizedComponent {}
