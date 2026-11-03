import { Component, EventEmitter, Input, Output, inject, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReceiptService } from '../../../core/services/receipt.service';
import { ShiftService } from '../../../core/services/shift.service';
import { ReceiptData } from '../../../core/models/receipt.model';

@Component({
  selector: 'app-receipt-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './receipt-modal.component.html',
  styleUrls: ['./receipt-modal.component.scss'],
})
export class ReceiptModalComponent implements OnChanges {
  @Input() postId!: number;
  @Input() postName = '';
  @Output() close = new EventEmitter<void>();
  @Output() topUp = new EventEmitter<{ postId: number; amount: number }>();

  private receiptService = inject(ReceiptService);
  private shiftService = inject(ShiftService);

  receipts: ReceiptData[] = [];
  amount = 0;
  loading = true;
  shiftOpenedAt: string | null = null;

  ngOnChanges(): void {
    if (this.postId == null) return;

    // Ждём, пока shiftService отдаст текущую смену
    this.shiftService.currentShift$.subscribe(shift => {
      this.shiftOpenedAt = shift?.openedAt ?? null;
      this.loadReceipts();
    });

    // На случай, если currentShift$ ещё не заполнен — запросим вручную
    this.shiftService.getCurrentShift().subscribe({
      next: shift => {
        this.shiftOpenedAt = shift?.openedAt ?? null;
        this.loadReceipts();
      },
      error: () => this.loadReceipts(),
    });
  }

  private loadReceipts(): void {
    this.loading = true;
    const all = this.receiptService['receipts'] || [];

    const from = this.shiftOpenedAt ? new Date(this.shiftOpenedAt) : new Date(0);
    const to = new Date();

    this.receipts = all
      .filter(r => Number(r.postId) === Number(this.postId))
      .filter(r => {
        const t = new Date(r.date).getTime();
        return t >= from.getTime() && t <= to.getTime();
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    this.loading = false;
  }

  get totalForShift(): number {
    return this.receipts.reduce((s, r) => s + (r.total || 0), 0);
  }

  confirmTopUp(): void {
    if (this.amount > 0) {
      this.topUp.emit({ postId: this.postId, amount: this.amount });
    }
    this.close.emit();
  }

  cancel(): void {
    this.close.emit();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }
}