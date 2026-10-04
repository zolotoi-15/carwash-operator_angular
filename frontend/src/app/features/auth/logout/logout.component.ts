import { Component, OnInit, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
@Component({ selector: 'app-logout', standalone: true, template: '' })
export class LogoutComponent implements OnInit {
  private auth = inject(AuthService);
  ngOnInit(): void { this.auth.logout(); }
}
