import { Component, inject, effect, DestroyRef } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AuthService } from './core/services/auth.service';
import { ShiftService } from './core/services/shift.service';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { HeaderComponent } from './shared/components/header/header.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    HeaderComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  auth = inject(AuthService);
  private shiftService = inject(ShiftService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    // Реактивно следим за состоянием аутентификации:
    //  • залогинен  → запускаем polling смены (детект auto-rotation);
    //  • разлогинен → останавливаем polling.
    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.shiftService.startAutoShiftWatch(30_000);
      } else {
        this.shiftService.stopAutoShiftWatch();
      }
    });

    // Чистим таймер при уничтожении корневого компонента
    this.destroyRef.onDestroy(() => this.shiftService.stopAutoShiftWatch());
  }
}