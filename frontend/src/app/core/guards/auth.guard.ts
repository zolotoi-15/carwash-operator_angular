import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  private auth = inject(AuthService);
  private router = inject(Router);
  canActivate(): boolean {
    if (this.auth.currentUser) return true;
    this.router.navigate(['/login']);
    return false;
  }
}
=======
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(): boolean {
    if (this.authService.currentUserValue) {
      return true;
    }
    this.router.navigate(['/login']);
    return false;
  }
}
