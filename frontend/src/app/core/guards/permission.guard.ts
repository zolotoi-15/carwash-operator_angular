import { Injectable, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ResourceType } from '../models/resource.enum';
import { PermissionAction } from '../models/action.enum';
@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {
  private auth = inject(AuthService);
  private router = inject(Router);
  canActivate(route: ActivatedRouteSnapshot): boolean {
    const r = route.data['resource'] as ResourceType | undefined;
    const a = (route.data['action'] as PermissionAction) ?? PermissionAction.Read;
    if (!r || this.auth.hasPermission(r, a)) return true;
    this.router.navigate(['/unauthorized']);
    return false;
  }
}
