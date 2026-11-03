import { Component, Input, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import Hls from 'hls.js';

@Component({
  selector: 'app-camera-stream',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="camera-container" *ngIf="url">
      <video #videoElement [autoplay]="true" [muted]="true" [playsinline]="true" class="camera-video"></video>
      <div *ngIf="!isConnected" class="camera-status">⏳ Подключение...</div>
    </div>
    <div class="camera-container" *ngIf="!url">
      <div class="camera-placeholder">📷 Камера не настроена</div>
    </div>
  `,
  styles: [`
    .camera-container { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 8px; overflow: hidden; margin-top: 8px; position: relative; }
    .camera-video { width: 100%; height: 100%; object-fit: cover; }
    .camera-status, .camera-placeholder { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: rgba(255,255,255,0.7); background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 4px; font-size: 12px; }
    .camera-placeholder { background: #ddd; color: #666; }
  `]
})
export class CameraStreamComponent implements OnInit, OnDestroy {
  @Input() url: string = '';
  @ViewChild('videoElement') videoRef!: ElementRef<HTMLVideoElement>;

  private hls: Hls | null = null;
  private mediaSource: MediaSource | null = null;
  isConnected = false;

  ngOnInit() {
    if (this.url) {
      this.initCamera();
    }
  }

  ngOnChanges() {
    if (this.url) {
      this.initCamera();
    }
  }

  private initCamera() {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    // Очистка предыдущего
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    video.pause();
    video.src = '';
    video.srcObject = null;
    this.isConnected = false;

    // Если URL заканчивается на .m3u8 или содержит hls
    if (this.url.includes('.m3u8') || this.url.includes('hls')) {
      if (Hls.isSupported()) {
        this.hls = new Hls();
        this.hls.loadSource(this.url);
        this.hls.attachMedia(video);
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(e => console.warn('Play error:', e));
          this.isConnected = true;
        });
        this.hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS error', data);
          this.isConnected = false;
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = this.url;
        video.addEventListener('loadedmetadata', () => {
          video.play().catch(e => console.warn('Play error:', e));
          this.isConnected = true;
        });
      }
    } else {
      // MJPEG или обычный видеофайл
      video.src = this.url;
      video.addEventListener('canplay', () => {
        video.play().catch(e => console.warn('Play error:', e));
        this.isConnected = true;
      });
      video.addEventListener('error', () => {
        console.error('Video error');
        this.isConnected = false;
      });
    }
  }

  ngOnDestroy() {
    if (this.hls) this.hls.destroy();
    const video = this.videoRef?.nativeElement;
    if (video) {
      video.pause();
      video.src = '';
      video.srcObject = null;
    }
  }
}
