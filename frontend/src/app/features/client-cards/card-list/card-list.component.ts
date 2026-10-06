import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ClientCardService } from '../../../core/services/client-card.service';
import { MqttService, CardScanEvent } from '../../../core/services/mqtt.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  ClientCard,
  CardOperation,
  CreateClientCardDto,
} from '../../../core/models/client-card.model';

@Component({
  selector: 'app-card-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './card-list.component.html',
  styleUrls: ['./card-list.component.scss'],
})
export class CardListComponent implements OnInit, OnDestroy {
  private cardService = inject(ClientCardService);
  private mqtt = inject(MqttService);
  private notify = inject(NotificationService);
  private router = inject(Router);

  cards: ClientCard[] = [];
  query = '';
  loading = false;

  newCard: CreateClientCardDto = {
    card: '', type: 'client', fullName: '', phone: '',
  };

  topUpAmount: Record<string, number> = {};

  reportModalOpen = false;
  reportCard: ClientCard | null = null;
  reportOperations: CardOperation[] = [];
  reportLoading = false;

  waitingScan = false;
  lastScan: CardScanEvent | null = null;

  private subs = new Subscription();

  ngOnInit(): void {
    this.loadCards();

    this.subs.add(
      this.mqtt.getCardScanUpdates().subscribe((event: CardScanEvent) => {
        this.lastScan = event;
        this.waitingScan = false;
        this.query = event.card;
        this.search();
        this.notify.success(`💳 Карта ${event.card} считана`);
      }),
    );

    this.subs.add(
      this.mqtt.getCardBalanceUpdates().subscribe(({ card, balance }) => {
        const idx = this.cards.findIndex((c) => c.card === card);
        if (idx >= 0) {
          this.cards[idx] = { ...this.cards[idx], balance };
        } else {
          this.search();
        }
      }),
    );
  }

  ngOnDestroy(): void { this.subs.unsubscribe(); }

  loadCards(): void {
    this.loading = true;
    this.cardService.getCards().subscribe({
      next: (data) => { this.cards = data; this.loading = false; },
      error: () => { this.notify.error('Не удалось загрузить карты'); this.loading = false; },
    });
  }

  search(): void {
    const q = this.query.trim();
    if (!q) { this.loadCards(); return; }
    this.loading = true;
    this.cardService.searchCards(q).subscribe({
      next: (data) => {
        this.cards = data; this.loading = false;
        if (!data.length) this.notify.warning(`Карта «${q}» не найдена`);
      },
      error: () => { this.notify.error('Ошибка поиска'); this.loading = false; },
    });
  }

  clearSearch(): void { this.query = ''; this.loadCards(); }

  addCard(): void {
    const num = (this.newCard.card || '').trim().toUpperCase();
    if (!num) { this.notify.warning('Введите номер карты'); return; }
    if (!/^[0-9A-F]+$/i.test(num)) { this.notify.warning('Только 0-9 и A-F'); return; }

    this.cardService.createCard({
      card: num,
      type: this.newCard.type,
      fullName: this.newCard.fullName?.trim() || undefined,
      phone: this.newCard.phone?.trim() || undefined,
    }).subscribe({
      next: () => {
        this.notify.success(`Карта ${num} добавлена`);
        this.newCard = { card: '', type: 'client', fullName: '', phone: '' };
        this.loadCards();
      },
      error: (err) => this.notify.error(err?.error?.error || 'Ошибка добавления'),
    });
  }

  topUp(card: ClientCard): void {
    const amount = this.topUpAmount[card.card];
    if (!amount || amount <= 0) { this.notify.warning('Введите сумму'); return; }
    this.cardService.topUp(card.card, amount).subscribe({
      next: (updated) => {
        this.notify.success(`Карта ${card.card} пополнена на ${amount} ₽`);
        this.topUpAmount[card.card] = 0;
        const idx = this.cards.findIndex((c) => c.card === card.card);
        if (idx >= 0) this.cards[idx] = updated;
      },
      error: () => this.notify.error('Ошибка пополнения'),
    });
  }

  deleteCard(card: ClientCard): void {
    if (!confirm(`Удалить карту ${card.card}?`)) return;
    this.cardService.deleteCard(card.card).subscribe({
      next: () => {
        this.notify.success(`Карта ${card.card} удалена`);
        this.cards = this.cards.filter((c) => c.card !== card.card);
      },
      error: () => this.notify.error('Ошибка удаления'),
    });
  }

  openReport(card: ClientCard): void {
    this.reportCard = card;
    this.reportModalOpen = true;
    this.reportLoading = true;
    this.reportOperations = [];
    this.cardService.getCardReport(card.card).subscribe({
      next: (resp) => { this.reportOperations = resp.operations; this.reportLoading = false; },
      error: () => { this.notify.error('Ошибка отчёта'); this.reportLoading = false; },
    });
  }

  closeReport(): void {
    this.reportModalOpen = false;
    this.reportCard = null;
    this.reportOperations = [];
  }

  scanCard(): void {
    this.waitingScan = true;
    this.mqtt.requestCardScan();
    this.notify.info('Ожидание сканирования...');
    setTimeout(() => {
      if (this.waitingScan) { this.waitingScan = false; this.notify.warning('Сканирование не выполнено'); }
    }, 15000);
  }

  formatBalance(value: number): string { return (value ?? 0).toFixed(2); }

  trackByCard(_i: number, item: ClientCard): string { return item.card; }
}