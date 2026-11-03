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
