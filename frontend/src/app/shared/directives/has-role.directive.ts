import { Directive, Input, TemplateRef, ViewContainerRef, inject, effect } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { Role } from '../../core/models/role.enum';

@Directive({ selector: '[appHasRole]', standalone: true })
export class HasRoleDirective {
  private tpl = inject(TemplateRef<unknown>);
  private vcr = inject(ViewContainerRef);
  private auth = inject(AuthService);

  private roles: Role[] = [];
  private rendered = false;

  @Input() set appHasRole(value: Role | Role[]) {
    this.roles = Array.isArray(value) ? value : [value];
    this.update();
  }

  constructor() {
    effect(() => {
      this.auth.currentUser$;
      this.update();
    });
  }

  private update(): void {
    const allowed = this.roles.length ? this.auth.hasAnyRole(this.roles) : false;
    if (allowed && !this.rendered) {
      this.vcr.createEmbeddedView(this.tpl);
      this.rendered = true;
    } else if (!allowed && this.rendered) {
      this.vcr.clear();
      this.rendered = false;
    }
  }
}