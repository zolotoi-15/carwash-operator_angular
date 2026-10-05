@Component({ /* ... */ })
export class SidebarComponent {
  menuItems$ = this.authService.currentUser$.pipe(
    map(user => MENU_ITEMS.filter(item => this.canShow(item, user)))
  );

  private canShow(item: MenuItem, user: User | null): boolean {
    if (!user) return false;
    if (item.route === '/logout') return true;
    if (item.allowedRoles && !item.allowedRoles.includes(user.group?.name as Role)) return false;
    if (item.resource && !this.authService.hasPermission(item.resource, PermissionAction.Read)) return false;
    return true;
  }
}