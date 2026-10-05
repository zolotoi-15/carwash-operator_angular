import { Injectable, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Role } from '../models/role.enum';
@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  private auth = inject(AuthService);
  private router = inject(Router);
  canActivate(route: ActivatedRouteSnapshot): boolean {
    const roles = (route.data['roles'] as Role[]) ?? [];
    if (!roles.length || this.auth.hasAnyRole(roles)) return true;
    this.router.navigate(['/unauthorized']);
    return false;
  }
}

import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private authService: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    const requiredRoles: string[] = route.data['roles'] || [];
    if (requiredRoles.length === 0) return true;

    const hasRole = requiredRoles.some(role => this.authService.hasRole(role));
    if (!hasRole) {
      this.router.navigate(['/unauthorized']);
    }
    return hasRole;
  }
}
