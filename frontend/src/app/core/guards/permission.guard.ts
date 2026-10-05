<<<<<<< Updated upstream
﻿import { Injectable, inject } from '@angular/core';
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
=======
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { PermissionService } from '../services/permission.service';
import { ResourceType, PermissionAction } from '../models/permission.model';

@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {
  constructor(private permissionService: PermissionService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    const resource: ResourceType = route.data['resource'];
    const action: PermissionAction = route.data['action'] || PermissionAction.Read;
    if (!resource) return true;

    if (!this.permissionService.hasPermission(resource, action)) {
      this.router.navigate(['/unauthorized']);
      return false;
    }
    return true;
  }
}
>>>>>>> Stashed changes
