// src/app/services/detection.service.ts
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DetectionService {
  private ws: WebSocket | null = null;
  private detectionSubject = new Subject<any>();

  connect(url: string = 'ws://0.0.0.0:8765') {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.ws = new WebSocket(url);
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.detectionSubject.next(data);
      } catch (e) { }
    };
    this.ws.onclose = () => console.warn('WebSocket closed, reconnecting in 3s...');
    this.ws.onerror = (err) => console.error('WebSocket error', err);
  }

  getDetections() {
    return this.detectionSubject.asObservable();
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
