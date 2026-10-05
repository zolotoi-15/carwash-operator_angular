@Component({ /* ... */ })
export class CardListComponent {
  cards$ = this.cardService.getCards();

  deleteCard(id: number): void {
    if (!this.authService.hasPermission(ResourceType.ClientCards, PermissionAction.Delete)) {
      this.notification.error('У вас нет прав на удаление карт');
      return;
    }
    this.cardService.deleteCard(id).subscribe(() => this.reload());
  }
}