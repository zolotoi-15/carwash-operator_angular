// src/app/features/client-cards/card-list/card-list.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClientCardService } from '../../../core/services/client-card.service';

@Component({
  selector: 'app-card-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="cards">
      <h2>💳 Карты клиентов</h2>
      <div class="search">
        <input placeholder="Поиск по номеру карты, ФИО или телефону..." [(ngModel)]="query" />
        <button>🔍 Найти</button>
        <button>📷 Сканировать карту</button>
      </div>
      <div class="add-card">
        <h3>Клиент</h3>
        <input placeholder="Номер карты" [(ngModel)]="newCard.number" />
        <input placeholder="ФИО (необязательно)" [(ngModel)]="newCard.name" />
        <input placeholder="Телефон (необязательно)" [(ngModel)]="newCard.phone" />
        <button (click)="addCard()">Добавить</button>
      </div>
      <table>
        <thead>
          <tr><th>Номер карты</th><th>ФИО</th><th>Телефон</th><th>Тип</th><th>Баланс</th><th>Пополнение</th><th>Действия</th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let c of cards">
            <td>{{ c.number }}</td>
            <td>{{ c.name || '—' }}</td>
            <td>{{ c.phone || '—' }}</td>
            <td>{{ c.type }}</td>
            <td>{{ c.balance | number:'1.2-2' }} ₽</td>
            <td>
              <input type="number" [(ngModel)]="c.topUpAmount" placeholder="Сумма" />
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
  `
})
export class CardListComponent implements OnInit {
  cards: any[] = [];
  query = '';
  newCard = { number: '', name: '', phone: '' };

  constructor(private cardService: ClientCardService) {}

  ngOnInit(): void {
    this.loadCards();
  }

  loadCards(): void {
    this.cardService.getCards().subscribe(data => this.cards = data);
  }

  addCard(): void {
    this.cardService.createCard(this.newCard).subscribe(() => this.loadCards());
  }

  topUp(card: any): void {
    this.cardService.topUp(card.id, card.topUpAmount).subscribe(() => this.loadCards());
  }

  deleteCard(card: any): void {
    this.cardService.deleteCard(card.id).subscribe(() => this.loadCards());
  }
}