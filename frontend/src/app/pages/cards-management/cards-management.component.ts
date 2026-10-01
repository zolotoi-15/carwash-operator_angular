import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ClientCard, ClientCardType } from '../../models/client-card.model';
import { ClientCardService } from '../../services/client-card.service';

@Component({
  selector: 'app-cards-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cards-management.component.html',
  styleUrls: ['./cards-management.component.css']
})
export class CardsManagementComponent implements OnInit {
  cards: ClientCard[] = [];

  newCardNumber = '';
  newCardType: ClientCardType = 'client';

  topUpAmounts: Record<string, number> = {};
  loading = false;
  errorMessage = '';

  constructor(private cardService: ClientCardService) { }

  ngOnInit(): void {
    this.loadCards();
  }

  loadCards(): void {
    this.loading = true;
    this.cardService.getCards().subscribe({
      next: (data) => {
        this.cards = data;
        this.loading = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Ошибка загрузки карт';
        this.loading = false;
      }
    });
  }

  addCard(): void {
    const card = this.newCardNumber.trim().toUpperCase();
    if (!card) {
      this.errorMessage = 'Введите номер карты';
      return;
    }
    this.cardService.addCard(card, this.newCardType).subscribe({
      next: () => {
        this.newCardNumber = '';
        this.newCardType = 'client';
        this.errorMessage = '';
        this.loadCards();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Ошибка добавления карты';
      }
    });
  }

  deleteCard(card: string): void {
    if (!confirm(`Удалить карту ${card}?`)) return;
    this.cardService.deleteCard(card).subscribe({
      next: () => this.loadCards(),
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Ошибка удаления';
      }
    });
  }

  topUp(card: string): void {
    const amount = Number(this.topUpAmounts[card]);
    if (!amount || amount <= 0) {
      this.errorMessage = 'Введите корректную сумму';
      return;
    }
    this.cardService.topUp(card, amount).subscribe({
      next: () => {
        this.topUpAmounts[card] = 0;
        this.errorMessage = '';
        this.loadCards();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Ошибка пополнения';
      }
    });
  }

  typeLabel(type: ClientCardType): string {
    switch (type) {
      case 'client': return 'Клиент';
      case 'operator': return 'Оператор';
      case 'service': return 'Администратор';
      default: return type;
    }
  }
}
