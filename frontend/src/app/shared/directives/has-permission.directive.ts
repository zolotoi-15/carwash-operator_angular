<<<<<<< Updated upstream
import { Directive, Input, TemplateRef, ViewContainerRef, inject, effect } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { ResourceType } from '../../core/models/resource.enum';
import { PermissionAction } from '../../core/models/action.enum';

@Directive({ selector: '[appHasPermission]', standalone: true })
export class HasPermissionDirective {
  private tpl = inject(TemplateRef<unknown>);
  private vcr = inject(ViewContainerRef);
  private auth = inject(AuthService);

  private resource?: ResourceType;
  private action: PermissionAction = PermissionAction.Read;
  private rendered = false;

  @Input() set appHasPermission(value: [ResourceType, PermissionAction]) {
    [this.resource, this.action] = value;
    this.update();
  }

  constructor() {
    effect(() => {
      this.auth.currentUser$;
      this.update();
    });
  }

  private update(): void {
    if (!this.resource) return;
    const allowed = this.auth.hasPermission(this.resource, this.action);
    if (allowed && !this.rendered) {
      this.vcr.createEmbeddedView(this.tpl);
      this.rendered = true;
    } else if (!allowed && this.rendered) {
      this.vcr.clear();
      this.rendered = false;
=======
@Directive({ selector: '[appHasPermission]', standalone: true })
export class HasPermissionDirective {
  @Input() set appHasPermission([resource, action]: [ResourceType, PermissionAction]) {
    if (this.authService.hasPermission(resource, action)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    } else {
      this.viewContainer.clear();
>>>>>>> Stashed changes
    }
  }
}