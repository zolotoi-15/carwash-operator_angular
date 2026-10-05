import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ClientCardService } from '../../../services/client-card.service';
import { ClientCard } from '../../../models/client-card.model';
import { AuthService } from '../../../core/services/auth.service';
import { ResourceType } from '../../../core/models/resource.enum';
import { PermissionAction } from '../../../core/models/action.enum';

@Component({
  selector: 'app-card-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="cards">
      <div class="header">
        <h1>💳 Карты клиентов</h1>
        <div class="search">
          <input [(ngModel)]="query" (input)="onSearch()" placeholder="Поиск по номеру, ФИО, телефону" />
        </div>
      </div>

      <p class="readonly" *ngIf="!canDelete">
        ℹ️ Режим просмотра — удаление карт недоступно
      </p>

      <table>
        <thead>
          <tr>
            <th>Карта</th><th>Тип</th><th>Баланс</th><th>ФИО</th><th>Телефон</th>
            <th *ngIf="canDelete">Действия</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let c of cards">
            <td><code>{{ c.card }}</code></td>
            <td>{{ c.type }}</td>
            <td><strong>{{ c.balance | number:'1.2-2' }} ₽</strong></td>
            <td>{{ c.fullName || '—' }}</td>
            <td>{{ c.phone || '—' }}</td>
            <td *ngIf="canDelete">
              <button class="icon-btn" (click)="deleteCard(c.card)" title="Удалить">🗑️</button>
            </td>
          </tr>
          <tr *ngIf="!cards.length">
            <td [attr.colspan]="canDelete ? 6 : 5" style="text-align:center;color:#94a3b8;padding:24px">
              Карт нет
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    h1 { color: #1e293b; margin: 0; }
    .search input { padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 6px; width: 320px; }
    .readonly { background: #dbeafe; color: #1e40af; padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 14px; }
    table { width: 100%; background: #fff; border-collapse: collapse; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; color: #475569; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
    .icon-btn { background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px 8px; }
  `]
})
export class CardListComponent implements OnInit, OnDestroy {
  private cardService = inject(ClientCardService);
  private auth = inject(AuthService);

  cards: ClientCard[] = [];
  query = '';
  private subs: Subscription[] = [];

  get canDelete(): boolean {
    return this.auth.hasPermission(ResourceType.ClientCards, PermissionAction.Delete);
  }

  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  load(): void {
    this.subs.push(this.cardService.getCards().subscribe({
      next: c => this.cards = c,
      error: () => this.cards = []
    }));
  }

  onSearch(): void {
    if (!this.query.trim()) { this.load(); return; }
    this.subs.push(this.cardService.searchCards(this.query).subscribe(c => this.cards = c));
  }

  deleteCard(card: string): void {
    if (!this.canDelete) return;
    if (!confirm(`Удалить карту ${card}?`)) return;
    this.subs.push(this.cardService.deleteCard(card).subscribe(() => this.load()));
  }
}