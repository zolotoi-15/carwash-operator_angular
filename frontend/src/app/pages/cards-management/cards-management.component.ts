import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ClientCard, ClientCardType } from '../../models/client-card.model';
import { ClientCardService } from '../../services/client-card.service';
import { MqttService } from '../../services/mqtt.service';
import { Router } from '@angular/router';

interface EditableCard extends ClientCard {
  topUpAmount?: number;
}

@Component({
  selector: 'app-cards-management',
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

    // Подписка на карт-ридер
    this.mqttSub = this.mqttService
      .subscribe<string>('card-reader/scan')
      .subscribe((cardNumber) => {
        if (!cardNumber) return;
        this.searchQuery = String(cardNumber).trim();
        this.onSearch();
      });
  }

  ngOnDestroy(): void {
    this.mqttSub?.unsubscribe();
  }

  loadCards(): void {
    this.cardService.getCards().subscribe((cards) => {
      this.cards = cards as EditableCard[];
      this.applyFilter();
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
        this.cards = cards as EditableCard[];
        this.applyFilter();
      },
      error: () => this.applyFilter(), // fallback на локальную фильтрацию
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

    this.cardService.addCard(this.newCard.card, type).subscribe({
      next: () => {
        if (this.newCard.fullName || this.newCard.phone) {
          this.cardService
            .updateCardInfo(this.newCard.card!, {
              fullName: this.newCard.fullName,
              phone: this.newCard.phone,
            })
            .subscribe(() => {
              this.loadCards();
              this.newCard = { type: 'client' };
            });
        } else {
          this.loadCards();
          this.newCard = { type: 'client' };
        }
      },
      error: (err) => alert('Ошибка при добавлении карты: ' + err.message),
    });
  }

  topUp(card: EditableCard): void {
    const amount = Number(card.topUpAmount);
    if (!amount || amount <= 0) {
      alert('Укажите сумму пополнения');
      return;
    }
    this.cardService.topUp(card.card, amount).subscribe(() => {
      card.topUpAmount = undefined;
      this.loadCards();
    });
  }

  deleteCard(card: EditableCard): void {
    if (!confirm(`Удалить карту ${card.card}?`)) return;
    this.cardService.deleteCard(card.card).subscribe(() => this.loadCards());
  }

  openReport(card: EditableCard): void {
    this.router.navigate(['/reports/card', card.card]);
  }

  /** Ручной запуск сканирования (если карт-ридер управляется командой) */
  scanCard(): void {
    this.mqttService.publish('card-reader/command', { action: 'scan' });
  }
}
