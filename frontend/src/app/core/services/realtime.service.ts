// src/app/core/services/realtime.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface RealtimeMessage {
  type: 'snapshot' | 'mqtt' | 'card-scan' | 'card-balance' | 'card-created';
  topic?: string;
  payload?: string;
  postId?: string;
  card?: string;
  balance?: number;
  cardType?: string;
  known?: boolean;
  error?: string;
  posts?: any;
  settings?: any;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private ws?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private messagesSubject = new Subject<RealtimeMessage>();
  private connectedSubject = new BehaviorSubject<boolean>(false);

  messages$ = this.messagesSubject.asObservable();
  connected$ = this.connectedSubject.asObservable();

  constructor() {
    this.connect();
  }

  private connect(): void {
  const explicit = (environment.wsUrl || '').trim();
  const url = explicit
    ? explicit
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  console.log('[Realtime] connecting to', url);

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.error('[Realtime] WebSocket creation failed', e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[Realtime] connected');
      this.connectedSubject.next(true);
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as RealtimeMessage;
        this.messagesSubject.next(msg);
      } catch (e) {
        console.warn('[Realtime] invalid JSON:', ev.data);
      }
    };

    this.ws.onclose = () => {
      console.warn('[Realtime] closed, reconnecting in 3s');
      this.connectedSubject.next(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[Realtime] error', err);
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  ngOnDestroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}