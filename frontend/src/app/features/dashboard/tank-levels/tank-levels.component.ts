// frontend/src/app/features/dashboard/tank-levels/tank-levels.component.ts
import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

import { RealtimeService, RealtimeMessage } from '../../../core/services/realtime.service';

interface Tank { key: string; label: string; level: number; }

@Component({
  selector: 'app-tank-levels',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <h3 class="card-title">🛢️ Уровни воды и химии</h3>
      <div class="tanks">
        @for (t of tanks; track t) {
          <div class="tank">
            <div class="tank-bar">
              <div class="tank-fill" [style.height.%]="t.level"></div>
            </div>
            <div class="tank-percent">{{ t.level }}%</div>
            <div class="tank-label">{{ t.label }}</div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      width: 100%;
      min-width: 0;
      height: 100%;
    }
    .card {
      flex: 1;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: #1e293b;
      color: #e2e8f0;
      border-radius: 10px;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
    }
    .card-title { margin: 0 0 12px; font-size: 15px; color: #fff; font-weight: 600; }
    .tanks {
      flex: 1; width: 100%;
      display: flex; justify-content: space-around;
      align-items: flex-end; gap: 12px; min-height: 140px; padding-top: 8px;
    }
    .tank {
      flex: 1; min-width: 0; height: 100%;
      display: flex; flex-direction: column;
      align-items: center; justify-content: flex-end;
    }
    .tank-bar {
      width: 100%; max-width: 48px; flex: 1;
      background: rgba(255,255,255,0.08);
      border-radius: 6px; overflow: hidden;
      display: flex; align-items: flex-end; margin-bottom: 6px;
    }
    .tank-fill {
      width: 100%;
      background: linear-gradient(to top, #38bdf8, #0ea5e9);
      transition: height 0.3s ease;
    }
    .tank-percent { margin-top: 4px; font-size: 12px; font-weight: 600; color: #fff; line-height: 1; }
    .tank-label { margin-top: 2px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1; }
    @media (max-width: 520px) {
      .tank-bar { max-width: 36px; }
      .tank-percent { font-size: 11px; }
      .tank-label { font-size: 10px; }
    }
  `]
})
export class TankLevelsComponent implements OnInit, OnDestroy {
  private realtime = inject(RealtimeService);

  tanks: Tank[] = [
    { key: 'water',   label: 'Вода',   level: 0 },
    { key: 'osmosis', label: 'Осмос',  level: 0 },
    { key: 'foam',    label: 'Пена',   level: 0 },
    { key: 'wax',     label: 'Воск',   level: 0 },
    { key: 'teflon',  label: 'Тефлон', level: 0 }
  ];

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.realtime.messages$.subscribe((msg) => this.handleRealtime(msg));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ============================================================
  // Обработка сообщений от RealtimeService
  // ============================================================
  private handleRealtime(msg: RealtimeMessage): void {
    // 1. Снапшот при подключении: settings.tankLevels
    if (msg.type === 'snapshot' && msg.settings?.tankLevels) {
      this.applyTankLevels(msg.settings.tankLevels);
      return;
    }

    if (msg.type !== 'mqtt' || !msg.topic) return;

    // 2. Явный топик tank/levels: { tank, level }
    if (msg.topic === 'tank/levels') {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (data.tank != null && data.level != null) {
          this.applyTankLevels({ [data.tank]: data.level });
        }
      } catch { /* ignore */ }
      return;
    }

    // 3. Совместимость: posts/<id>/status с полем data.tanks
    if (/^posts\/\d+\/status$/.test(msg.topic)) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (data?.tanks) this.applyTankLevels(data.tanks);
      } catch { /* ignore */ }
      return;
    }

    // 4. Общая конфигурация system/config — тоже может нести tankLevels
    if (msg.topic === 'system/config') {
      try {
        const cfg = JSON.parse(msg.payload || '{}');
        if (cfg?.tankLevels) this.applyTankLevels(cfg.tankLevels);
      } catch { /* ignore */ }
    }
  }

  private applyTankLevels(levels: Record<string, unknown>): void {
    this.tanks = this.tanks.map(t => {
      const raw = levels?.[t.key];
      if (raw == null) return t;
      const n = Number(raw);
      if (isNaN(n)) return t;
      return { ...t, level: Math.max(0, Math.min(100, Math.round(n))) };
    });
  }
}