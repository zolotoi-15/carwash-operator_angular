import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/components/header/header.component';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HeaderComponent, SidebarComponent],
  template: `
    <div class="app-layout">
      <app-sidebar *ngIf="auth.currentUser$ | async"></app-sidebar>
      <div class="app-main" [class.with-sidebar]="auth.currentUser$ | async">
        <app-header *ngIf="auth.currentUser$ | async"></app-header>
        <main class="app-content">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `,
  styles: [`
    .app-layout { display: flex; min-height: 100vh; }
    .app-main { flex: 1; display: flex; flex-direction: column; }
    .app-content { flex: 1; padding: 24px; background: #f5f7fa; }
  `]
})
export class AppComponent implements OnInit {
  constructor(public auth: AuthService) {}

  ngOnInit(): void {
    this.auth.restoreSession();
  }
}