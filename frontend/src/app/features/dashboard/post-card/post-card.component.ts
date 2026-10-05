import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { LocalPostService, PostState } from '../../../services/local-post.service';
import { ServiceConfig } from '../../../services/mqtt.service';

@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="post-card" [class.offline]="offline" [class.busy]="state.busy">
      <div class="post-header">
        <h3>Пост {{ postId }}</h3>
        <span class="status" [class.online]="!offline" [class.off]="offline">
          {{ offline ? '🔴 offline' : '🟢 online' }}
        </span>
      </div>

      <div class="post-body">
        <div class="row"><span>Баланс:</span>
          <strong>{{ state.balance | number:'1.2-2' }} ₽</strong></div>
        <div class="row"><span>Программа:</span>
          <strong>{{ state.currentProgram || '—' }}</strong></div>
        <div class="row"><span>Время:</span>
          <strong>{{ formatTime(state.elapsedSec) }}</strong></div>
        <div class="row"><span>Оплачено:</span>
          <strong>{{ state.totalPaid | number:'1.2-2' }} ₽</strong></div>
      </div>

      <div class="programs">
        <button *ngFor="let s of services"
                [disabled]="offline || state.busy"
                (click)="onStart(s.name)"
                [title]="s.price + ' ₽'">
          {{ s.name }}
        </button>
      </div>

      <div class="actions">
        <button class="btn-add" (click)="onAddBalance()" [disabled]="!offline">+ 100 ₽</button>
        <button class="btn-pause" (click)="onTogglePause()" [disabled]="!state.busy">⏸ Пауза</button>
        <button class="btn-stop" (click)="onStop()" [disabled]="!state.busy">⏹ Стоп</button>
      </div>
    </div>
  `,
  styles: [`
    .post-card { background: #fff; border-radius: 12px; padding: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08); border: 2px solid #e2e8f0; }
    .post-card.offline { border-color: #fca5a5; opacity: 0.85; }
    .post-card.busy { border-color: #22c55e; box-shadow: 0 2px 12px rgba(34,197,94,0.25); }
    .post-header { display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #f1f5f9; }
    .post-header h3 { margin: 0; font-size: 18px; color: #1e293b; }
    .status { font-size: 12px; padding: 3px 8px; border-radius: 12px; font-weight: 600; }
    .status.online { background: #dcfce7; color: #166534; }
    .status.off { background: #fee2e2; color: #991b1b; }
    .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
    .row span { color: #64748b; }
    .row strong { color: #1e293b; }
    .programs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .programs button { flex: 1 1 calc(50% - 3px); padding: 8px 10px; font-size: 12px;
      background: #0ea5e9; color: #fff; border: none; border-radius: 6px;
      cursor: pointer; font-weight: 500; }
    .programs button:hover:not(:disabled) { background: #0284c7; }
    .programs button:disabled { background: #cbd5e1; cursor: not-allowed; }
    .actions { display: flex; gap: 6px; }
    .actions button { flex: 1; padding: 8px; font-size: 12px; border: none;
      border-radius: 6px; cursor: pointer; font-weight: 500; }
    .btn-add { background: #10b981; color: #fff; }
    .btn-pause { background: #f59e0b; color: #fff; }
    .btn-stop { background: #ef4444; color: #fff; }
    .actions button:disabled { background: #e2e8f0; color: #94a3b8; cursor: not-allowed; }
  `]
})
export class PostCardComponent implements OnInit, OnDestroy {
  @Input() postId!: string;

  state: PostState = {
    busy: false, paused: false, balance: 0, currentProgram: '-',
    elapsedSec: 0, totalPaid: 0, receiptCount: 0, timer: null,
    servicesUsage: {}, receiptSent: false, pricePerSecond: 0
  };
  offline = true;
  services: ServiceConfig[] = [];

  private subs: Subscription[] = [];

  constructor(private localPost: LocalPostService) {}

  ngOnInit(): void {
    this.subs.push(this.localPost.getPostsObservable().subscribe(list => {
      const found = list.find(p => p.postId === this.postId);
      if (found) this.state = found.state;
    }));

    this.subs.push(this.localPost.getOfflineModeObservable().subscribe(list => {
      const found = list.find(p => p.postId === this.postId);
      this.offline = found ? found.offline : this.localPost.isPostOffline(this.postId);
    }));

    this.subs.push(this.localPost.getServicesObservable().subscribe(list => {
      this.services = list;
    }));

    this.state = this.localPost.getPostState(this.postId);
    this.offline = this.localPost.isPostOffline(this.postId);
  }

  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  formatTime(sec: number): string {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  onStart(program: string): void { this.localPost.startProgram(this.postId, program); }
  onAddBalance(): void { this.localPost.addBalance(this.postId, 100); }
  onTogglePause(): void { this.localPost.togglePause(this.postId); }
  onStop(): void { this.localPost.stopProgram(this.postId); }
}