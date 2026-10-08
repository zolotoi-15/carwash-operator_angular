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
  templateUrl: './tank-levels.component.html',
  styleUrls: ['./tank-levels.component.scss'],
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
  // Обработка сообщений RealtimeService
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

    // 3. Совместимость: posts/<id>/status с полем tanks
    if (/^posts\/\d+\/status$/.test(msg.topic)) {
      try {
        const data = JSON.parse(msg.payload || '{}');
        if (data?.tanks) this.applyTankLevels(data.tanks);
      } catch { /* ignore */ }
      return;
    }

    // 4. system/config — тоже может нести tankLevels
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