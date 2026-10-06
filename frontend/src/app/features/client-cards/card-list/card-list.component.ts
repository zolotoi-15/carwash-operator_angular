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
  CreateClientCardDto,
  CardOperation,
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
    number: '',
    name: '',
    phone: '',
    type: 'client',
  };

  /** ✅ Ключ — string (Mongo ObjectId), а не number */
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
        const where = event.postId ? ` (пост ${event.postId})` : '';
        this.notify.success(`💳 Карта ${event.card}${where} считана`);
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ============================================================
  // Загрузка и поиск
  // ============================================================
  loadCards(): void {
    this.loading = true;
    this.cardService.getCards().subscribe({
      next: (data: ClientCard[]) => {
        this.cards = data;
        this.loading = false;
      },
      error: () => {
        this.notify.error('Не удалось загрузить карты');
        this.loading = false;
      },
    });
  }

  search(): void {
    const q = this.query.trim();
    if (!q) {
      this.loadCards();
      return;
    }
    this.loading = true;
    this.cardService.searchCards(q).subscribe({
      next: (data: ClientCard[]) => {
        this.cards = data;
        this.loading = false;
        if (!data.length) this.notify.warning(`Карта «${q}» не найдена`);
      },
      error: () => {
        this.notify.error('Ошибка поиска');
        this.loading = false;
      },
    });
  }

  clearSearch(): void {
    this.query = '';
    this.loadCards();
  }

  // ============================================================
  // Создание карты
  // ============================================================
  addCard(): void {
    const num = (this.newCard.number || '').trim().toUpperCase();
    if (!num) {
      this.notify.warning('Введите номер карты');
      return;
    }
    if (!/^[0-9A-F]+$/i.test(num)) {
      this.notify.warning('Номер карты: только 0-9 и A-F');
      return;
    }

    this.cardService
      .createCard({
        number: num,
        name: this.newCard.name?.trim() || undefined,
        phone: this.newCard.phone?.trim() || undefined,
        type: this.newCard.type ?? 'client',
      })
      .subscribe({
        next: () => {
          this.notify.success(`Карта ${num} добавлена`);
          this.newCard = { number: '', name: '', phone: '', type: 'client' };
          this.loadCards();
        },
        error: (err) => {
          const msg = err?.error?.error || 'Ошибка добавления';
          this.notify.error(msg);
        },
      });
  }

  // ============================================================
  // Пополнение
  // ============================================================
  topUp(card: ClientCard): void {
    const amount = this.topUpAmount[card.id];
    if (!amount || amount <= 0) {
      this.notify.warning('Введите сумму');
      return;
    }
    this.cardService.topUp(card.id, { amount }).subscribe({
      next: (updated: ClientCard) => {
        this.notify.success(`Карта ${card.number} пополнена на ${amount} ₽`);
        this.topUpAmount[card.id] = 0;
        const idx = this.cards.findIndex(c => c.id === card.id);
        if (idx >= 0) this.cards[idx] = { ...updated };
      },
      error: () => this.notify.error('Ошибка пополнения'),
    });
  }

  // ============================================================
  // Удаление
  // ============================================================
  deleteCard(card: ClientCard): void {
    if (!confirm(`Удалить карту ${card.number}?`)) return;
    this.cardService.deleteCard(card.id).subscribe({
      next: () => {
        this.notify.success(`Карта ${card.number} удалена`);
        this.cards = this.cards.filter(c => c.id !== card.id);
      },
      error: () => this.notify.error('Ошибка удаления'),
    });
  }

  // ============================================================
  // Отчёт
  // ============================================================
  openReport(card: ClientCard): void {
    this.reportCard = card;
    this.reportModalOpen = true;
    this.reportLoading = true;
    this.reportOperations = [];
    this.cardService.getCardOperations(card.id).subscribe({
      next: (ops: CardOperation[]) => {
        this.reportOperations = ops;
        this.reportLoading = false;
      },
      error: () => {
        this.notify.error('Ошибка отчёта');
        this.reportLoading = false;
      },
    });
  }

  closeReport(): void {
    this.reportModalOpen = false;
    this.reportCard = null;
    this.reportOperations = [];
  }

  // ============================================================
  // Сканирование карты через MQTT
  // ============================================================
  scanCard(): void {
    this.waitingScan = true;
    this.mqtt.requestCardScan();
    this.notify.info('Ожидание сканирования...');
    setTimeout(() => {
      if (this.waitingScan) {
        this.waitingScan = false;
        this.notify.warning('Сканирование не выполнено');
      }
    }, 15000);
  }

  // ============================================================
  // Утилиты
  // ============================================================
  formatBalance(value: number): string {
    return (value ?? 0).toFixed(2);
  }

  /** ✅ Возвращает string (Mongo ObjectId), а не number */
  trackById(_i: number, item: ClientCard): string {
    return item.id;
  }

  goToReportPage(card: ClientCard): void {
    this.router.navigate(['/client-cards', card.id, 'report']);
  }
}