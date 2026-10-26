import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { ShiftService } from './core/services/shift.service';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { HeaderComponent } from './shared/components/header/header.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, HeaderComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  auth = inject(AuthService);
  private shiftService = inject(ShiftService);

  ngOnInit(): void {
    // Запускаем мониторинг смены только для залогиненных пользователей
    if (this.auth.isAuthenticated()) {
      this.shiftService.startAutoShiftWatch(30_000);
    }
  }

  ngOnDestroy(): void {
    this.shiftService.stopAutoShiftWatch();
  }
}