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