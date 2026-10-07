import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ClientCardService } from '../../../core/services/client-card.service';
import { MqttService, CardScanEvent } from '../../../core/services/mqtt.service';
import { RealtimeService, RealtimeMessage } from '../../../core/services/realtime.service';
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
  private realtime = inject(RealtimeService);
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

  /** id последнего поста, откуда пришёл скан (для подсветки) */
  lastScanPostId: string | null = null;

  private subs = new Subscription();

  ngOnInit(): void {
    this.loadCards();

    // MQTT — оставляем для совместимости (сканы, инициированные из UI)
    this.subs.add(
      this.mqtt.getCardScanUpdates().subscribe((event: CardScanEvent) => {
        this.lastScan = event;
        this.waitingScan = false;
        this.lastScanPostId = event.postId ?? null;
        this.query = event.card;
        this.search();
        this.notify.success(`💳 Карта ${event.card} считана`);
      }),
    );

    // MQTT — баланс (локальные обновления)
    this.subs.add(
      this.mqtt.getCardBalanceUpdates().subscribe(({ card, balance }) => {
        this.applyCardBalance(card, balance);
      }),
    );

    // 🔥 WebSocket — трансляция с backend (все клиенты получают одинаковые данные)
    this.subs.add(
      this.realtime.messages$.subscribe((msg) => this.handleRealtime(msg)),
    );
  }

  ngOnDestroy(): void { this.subs.unsubscribe(); }

  // ============================================================
  // WebSocket-события от backend
  // ============================================================
  private handleRealtime(msg: RealtimeMessage): void {
    switch (msg.type) {
      case 'card-scan':
        this.onCardScan(msg);
        break;

      case 'card-balance':
        this.applyCardBalance(msg.card || '', Number(msg.balance || 0));
        break;

      case 'card-created':
        if (msg.card) {
          // Автосозданная карта (если ты включил автосоздание на бэкенде)
          this.loadCards();
        }
        break;

      case 'snapshot':
        // Первичное состояние после подключения.
        // Можно при желании применить msg.posts.
        break;

      case 'mqtt':
        // Трансляция всех MQTT-сообщений. Пока не обрабатываем.
        break;
    }
  }

  /**
   * Событие сканирования карты с терминала.
   * Если карта уже в списке — обновить баланс.
   * Если не известна — показать оператору, что карта не найдена.
   */
  private onCardScan(msg: RealtimeMessage): void {
    const card = (msg.card || '').toUpperCase();
    const balance = Number(msg.balance || 0);
    const postId = msg.postId ?? '—';
    this.lastScanPostId = msg.postId ?? null;

    const idx = this.cards.findIndex(c => c.card === card);
    if (idx >= 0) {
      // Карта есть — обновляем баланс
      this.cards[idx] = { ...this.cards[idx], balance };
      this.notify.info(`💳 Карта ${card} (пост ${postId}): баланс ${balance.toFixed(2)} ₽`);
      return;
    }

    // Карты нет в текущем списке
    if (msg.known === false) {
      // На бэкенде карта не найдена в БД
      this.notify.warning(`Неизвестная карта ${card} (пост ${postId})`);
    } else {
      // Карта есть в БД, но её нет в отображаемом списке — подтянуть
      this.loadCards();
    }
  }

  private applyCardBalance(card: string, balance: number): void {
    if (!card) return;
    const idx = this.cards.findIndex(c => c.card === card);
    if (idx >= 0) {
      this.cards[idx] = { ...this.cards[idx], balance };
    }
  }

  // ============================================================
  // REST
  // ============================================================
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
        const idx = this.cards.findIndex(c => c.card === card.card);
        if (idx >= 0) this.cards[idx] = updated;
      },
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Ошибка пополнения';
        this.notify.error(msg);
      },
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