import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { ClientCard, ClientCardType } from '../../models/client-card.model';
import { ClientCardService } from '../../services/client-card.service';
import { MqttService, CardScanEvent } from '../../services/mqtt.service';

interface EditableCard extends ClientCard {
  topUpAmount?: number;
}

@Component({
  selector: 'app-cards-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cards-management.component.html',
  styleUrls: ['./cards-management.component.scss'],
})
export class CardsManagementComponent implements OnInit, OnDestroy {
  cards: EditableCard[] = [];
  filteredCards: EditableCard[] = [];
  searchQuery = '';
  newCard: Partial<ClientCard> = { type: 'client' };

  private mqttSub?: Subscription;

  constructor(
    private cardService: ClientCardService,
    private mqttService: MqttService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadCards();

    // Подписка на события карт-ридера (из MqttService)
    this.mqttSub = this.mqttService
      .getCardScanUpdates()
      .subscribe((event: CardScanEvent) => {
        if (!event?.card) return;
        this.searchQuery = event.card;
        this.onSearch();

        if (event.topUpStatus === 'ok' && event.topUpAmount && event.postId) {
          console.log(
            `Карта ${event.card} пополнена на ${event.topUpAmount.toFixed(2)} ₽ ` +
            `с баланса поста ${event.postId}`,
          );
        } else if (event.topUpStatus === 'error') {
          console.warn(
            `Не удалось перенести баланс с поста ${event.postId} на карту ${event.card}`,
          );
        }
      });
  }

  ngOnDestroy(): void {
    this.mqttSub?.unsubscribe();
  }

  loadCards(): void {
    this.cardService.getCards().subscribe({
      next: (cards) => {
        this.cards = (cards || []) as EditableCard[];
        this.applyFilter();
      },
      error: (err) => console.error('Не удалось загрузить карты', err),
    });
  }

  onSearch(): void {
    const q = this.searchQuery.trim();
    if (!q) {
      this.applyFilter();
      return;
    }
    this.cardService.searchCards(q).subscribe({
      next: (cards) => {
        this.cards = (cards || []) as EditableCard[];
        this.applyFilter();
      },
      error: () => {
        // Фолбэк: локальная фильтрация по уже загруженному списку
        this.applyFilter();
      },
    });
  }

  applyFilter(): void {
    const q = this.searchQuery.trim().toLowerCase();
    this.filteredCards = q
      ? this.cards.filter(
          (c) =>
            c.card.toLowerCase().includes(q) ||
            (c.fullName?.toLowerCase().includes(q) ?? false) ||
            (c.phone?.toLowerCase().includes(q) ?? false),
        )
      : [...this.cards];
  }

  addCard(): void {
    if (!this.newCard.card) {
      alert('Укажите номер карты');
      return;
    }
    const type = (this.newCard.type ?? 'client') as ClientCardType;
    const cardNumber = this.newCard.card.trim().toUpperCase();

    this.cardService.addCard(cardNumber, type).subscribe({
      next: () => {
        if (this.newCard.fullName || this.newCard.phone) {
          this.cardService
            .updateCardInfo(cardNumber, {
              fullName: this.newCard.fullName,
              phone: this.newCard.phone,
            })
            .subscribe({
              next: () => {
                this.loadCards();
                this.newCard = { type: 'client' };
              },
              error: (err) => {
                console.error('Не удалось сохранить ФИО/телефон', err);
                this.loadCards();
                this.newCard = { type: 'client' };
              },
            });
        } else {
          this.loadCards();
          this.newCard = { type: 'client' };
        }
      },
      error: (err) => alert('Ошибка при добавлении карты: ' + (err?.message || err)),
    });
  }

  topUp(card: EditableCard): void {
    const amount = Number(card.topUpAmount);
    if (!amount || amount <= 0) {
      alert('Укажите сумму пополнения');
      return;
    }
    this.cardService.topUp(card.card, amount).subscribe({
      next: () => {
        card.topUpAmount = undefined;
        this.loadCards();
      },
      error: (err) => alert('Ошибка пополнения: ' + (err?.message || err)),
    });
  }

  deleteCard(card: EditableCard): void {
    if (!confirm(`Удалить карту ${card.card}?`)) return;
    this.cardService.deleteCard(card.card).subscribe({
      next: () => this.loadCards(),
      error: (err) => alert('Ошибка удаления: ' + (err?.message || err)),
    });
  }

  /** Ручной запуск сканирования (если ридер это поддерживает) */
  scanCard(): void {
    this.mqttService.requestCardScan();
  }

  /** Переход на страницу отчёта по карте */
  openReport(card: EditableCard): void {
    this.router.navigate(['/reports/card', card.card]);
  }
}
