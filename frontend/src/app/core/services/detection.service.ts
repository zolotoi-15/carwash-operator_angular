import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, interval, switchMap, startWith } from 'rxjs';
import { environment } from '../../../environments/environment';  // ← 3 уровня, не 4

export interface DetectionStatus {
  ready: boolean;
  connected: boolean;
  camera?: string;
  postId?: number | null;
  plate?: string | null;
  confidence?: number;
  lastDetectionAt?: string;
  errors?: string[];
}

@Injectable({ providedIn: 'root' })
export class DetectionService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}`;

  private statusSubject = new BehaviorSubject<DetectionStatus | null>(null);
  private plateSubject = new BehaviorSubject<{ postId: number; plate: string } | null>(null);

  startPolling(periodMs = 5000): Observable<DetectionStatus> {
    return interval(periodMs).pipe(
      startWith(0),
      switchMap(() => this.http.get<DetectionStatus>(`${this.apiUrl}/detection/status`))
    );
  }

  getStatus(): Observable<DetectionStatus> {
    return this.http.get<DetectionStatus>(`${this.apiUrl}/detection/status`);
  }

  detect(postId: number, imageBase64?: string): Observable<{ plate: string; confidence: number }> {
    return this.http.post<{ plate: string; confidence: number }>(
      `${this.apiUrl}/detection/detect`,
      { postId, image: imageBase64 }
    );
  }

  getStatusUpdates(): Observable<DetectionStatus | null> {
    return this.statusSubject.asObservable();
  }

  getPlateUpdates(): Observable<{ postId: number; plate: string } | null> {
    return this.plateSubject.asObservable();
  }

  emitPlate(postId: number, plate: string): void {
    this.plateSubject.next({ postId, plate });
  }
}