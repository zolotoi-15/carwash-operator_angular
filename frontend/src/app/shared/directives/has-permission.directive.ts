@Directive({ selector: '[appHasPermission]', standalone: true })
export class HasPermissionDirective {
  @Input() set appHasPermission([resource, action]: [ResourceType, PermissionAction]) {
    if (this.authService.hasPermission(resource, action)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    } else {
      this.viewContainer.clear();
    }
  }
}