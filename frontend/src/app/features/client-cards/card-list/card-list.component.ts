import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClientCardService } from '../../../core/services/client-card.service';
import { ClientCard } from '../../../core/models/client-card.model';

@Component({
  selector: 'app-card-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="cards-page">
      <h2>💳 Карты клиентов</h2>

      <div class="search-row">
        <input placeholder="Поиск по номеру карты, ФИО или телефону..." [(ngModel)]="query" />
        <button (click)="search()">🔍 Найти</button>
        <button>📷 Сканировать карту</button>
      </div>

      <div class="add-row">
        <h3>Клиент</h3>
        <input placeholder="Номер карты" [(ngModel)]="newCard.number" />
        <input placeholder="ФИО (необязательно)" [(ngModel)]="newCard.name" />
        <input placeholder="Телефон (необязательно)" [(ngModel)]="newCard.phone" />
        <button (click)="addCard()">Добавить</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Номер карты</th>
            <th>ФИО</th>
            <th>Телефон</th>
            <th>Тип</th>
            <th>Баланс</th>
            <th>Пополнение</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let c of cards">
            <td>{{ c.number }}</td>
            <td>{{ c.name || '—' }}</td>
            <td>{{ c.phone || '—' }}</td>
            <td>{{ c.type }}</td>
            <td>{{ c.balance | number:'1.2-2' }} ₽</td>
            <td>
              <input type="number" [(ngModel)]="topUpAmount[c.id]" placeholder="Сумма" />
              <button (click)="topUp(c)">Пополнить</button>
            </td>
            <td>
              <button>Отчёт</button>
              <button (click)="deleteCard(c)">Удалить</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    .cards-page { padding: 24px; }
    .search-row, .add-row {
      display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center;
    }
    input, button { padding: 6px 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
  `]
})
export class CardListComponent implements OnInit {
  private cardService = inject(ClientCardService);

  cards: ClientCard[] = [];
  query = '';
  newCard = { number: '', name: '', phone: '' };
  topUpAmount: Record<number, number> = {};

  ngOnInit(): void {
    this.loadCards();
  }

  loadCards(): void {
    this.cardService.getCards().subscribe((data: ClientCard[]) => this.cards = data);
  }

  search(): void {
    if (!this.query.trim()) {
      this.loadCards();
      return;
    }
    this.cardService.searchCards(this.query).subscribe((data: ClientCard[]) => this.cards = data);
  }

  addCard(): void {
    if (!this.newCard.number.trim()) return;
    this.cardService.createCard(this.newCard).subscribe(() => {
      this.newCard = { number: '', name: '', phone: '' };
      this.loadCards();
    });
  }

  topUp(card: ClientCard): void {
    const amount = this.topUpAmount[card.id];
    if (!amount || amount <= 0) return;
    this.cardService.topUp(card.id, { amount }).subscribe(() => {
      this.topUpAmount[card.id] = 0;
      this.loadCards();
    });
  }

  deleteCard(card: ClientCard): void {
    if (!confirm(`Удалить карту ${card.number}?`)) return;
    this.cardService.deleteCard(card.id).subscribe(() => this.loadCards());
  }
}