// src/app/components/camera-with-detection/camera-with-detection.component.ts
import { Component, Input, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DetectionService } from '../../core/servicesdetection.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-camera-with-detection',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="video-container">
      <video #videoElement autoplay muted playsinline [src]="videoUrl" (loadedmetadata)="onVideoLoaded()"></video>
      <canvas #canvasElement class="overlay-canvas"></canvas>
      <div class="counts" *ngIf="counts">
        <span *ngFor="let item of counts | keyvalue" class="count-badge">
          {{ item.key }}: {{ item.value }}
        </span>
      </div>
    </div>
  `,
  styles: [`
    .video-container {
      position: relative;
      width: 100%;
      aspect-ratio: 16/9;
      background: #000;
      border-radius: 8px;
      overflow: hidden;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .overlay-canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .counts {
      position: absolute;
      top: 10px;
      left: 10px;
      display: flex;
      gap: 10px;
      pointer-events: none;
    }
    .count-badge {
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 14px;
      border: 1px solid rgba(255,255,255,0.3);
    }
  `]
})
export class CameraWithDetectionComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() videoUrl!: string;
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;

  private canvasCtx!: CanvasRenderingContext2D;
  private detectionSubscription!: Subscription;
  counts: { [key: string]: number } = {};

  constructor(private detectionService: DetectionService) { }

  ngOnInit() {
    this.detectionService.connect();
    this.detectionSubscription = this.detectionService.getDetections().subscribe(data => {
      this.drawDetections(data.detections || []);
      this.counts = data.counts || {};
    });
  }

  ngAfterViewInit() {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    this.canvasCtx = canvas.getContext('2d')!;

    // Синхронизация размеров
    const resize = () => {
      const rect = video.getBoundingClientRect();
      canvas.width = video.videoWidth || rect.width;
      canvas.height = video.videoHeight || rect.height;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
    };
    resize();
    window.addEventListener('resize', resize);
  }

  onVideoLoaded() {
    // Подгоняем canvas под размер видео
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.style.width = video.clientWidth + 'px';
    canvas.style.height = video.clientHeight + 'px';
  }

  drawDetections(detections: any[]) {
    const ctx = this.canvasCtx;
    const canvas = this.canvasElement.nativeElement;
    const video = this.videoElement.nativeElement;
    if (!ctx || !canvas || !video) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Масштабируем координаты bbox на размер canvas
    const scaleX = canvas.width / video.videoWidth;
    const scaleY = canvas.height / video.videoHeight;

    detections.forEach(det => {
      const [x1, y1, x2, y2] = det.bbox;
      const label = det.label;
      const trackId = det.track_id;

      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(x1 * scaleX, y1 * scaleY, (x2 - x1) * scaleX, (y2 - y1) * scaleY);

      // Подпись
      ctx.fillStyle = 'rgba(0,255,0,0.7)';
      ctx.font = '16px Arial';
      const text = `${label} (${trackId.substring(0, 4)})`;
      const textWidth = ctx.measureText(text).width;
      ctx.fillRect(x1 * scaleX, y1 * scaleY - 22, textWidth + 10, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x1 * scaleX + 5, y1 * scaleY - 4);
    });
  }

  ngOnDestroy() {
    this.detectionSubscription?.unsubscribe();
    this.detectionService.disconnect();
  }
}
