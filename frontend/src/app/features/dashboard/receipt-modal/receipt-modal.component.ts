import { Component, EventEmitter, Input, Output, OnInit, inject } from '@angular/core';
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
export class ReceiptModalComponent implements OnInit {
  @Input() postId!: number;
  @Output() close = new EventEmitter<void>();
  @Output() topUp = new EventEmitter<{ postId: number; amount: number }>();

  private receiptService = inject(ReceiptService);
  private shiftService = inject(ShiftService);

  receipts: ReceiptData[] = [];
  amount = 0;
  shiftOpenedAt: string | null = null;

  ngOnInit(): void {
    this.shiftService.currentShift$.subscribe(shift => {
      this.shiftOpenedAt = shift?.openedAt ?? null;
      this.loadReceipts();
    });

    // На случай, если currentShift$ ещё не заполнен
    this.shiftService.getCurrentShift().subscribe({
      next: shift => {
        this.shiftOpenedAt = shift?.openedAt ?? null;
        this.loadReceipts();
      },
      error: () => this.loadReceipts(),
    });
  }

  private loadReceipts(): void {
    const from = this.shiftOpenedAt ? new Date(this.shiftOpenedAt) : new Date(0);
    const to = new Date();

    this.receipts = this.receiptService
      .getReceiptsForPeriod(from, to)
      .filter(r => Number(r.postId) === Number(this.postId))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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