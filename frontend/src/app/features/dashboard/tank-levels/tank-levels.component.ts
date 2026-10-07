import { Component, OnInit, OnDestroy, inject } from '@angular/core';

import { Subscription } from 'rxjs';
import { MqttService } from '../../../core/services/mqtt.service';

interface Tank { key: string; label: string; level: number; }

@Component({
  selector: 'app-tank-levels',
  standalone: true,
  imports: [],
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
    .card { background: #1e293b; color: #e2e8f0; border-radius: 10px; padding: 16px; }
    .card-title { margin: 0 0 16px; font-size: 15px; color: #fff; }
    .tanks { display: flex; justify-content: space-around; gap: 8px; align-items: flex-end; height: 160px; }
    .tank { display: flex; flex-direction: column; align-items: center; flex: 1; }
    .tank-bar {
      width: 40px; height: 110px;
      background: rgba(255,255,255,0.08);
      border-radius: 6px; overflow: hidden;
      display: flex; align-items: flex-end;
    }
    .tank-fill {
      width: 100%;
      background: linear-gradient(to top, #38bdf8, #0ea5e9);
      transition: height 0.3s ease;
    }
    .tank-percent { margin-top: 6px; font-size: 12px; font-weight: 600; color: #fff; }
    .tank-label { margin-top: 2px; font-size: 11px; color: #94a3b8; text-align: center; }
  `]
})
export class TankLevelsComponent implements OnInit, OnDestroy {
  private mqtt = inject(MqttService);

  tanks: Tank[] = [
    { key: 'water',   label: 'Вода',   level: 0 },
    { key: 'osmosis', label: 'Осмос',  level: 0 },
    { key: 'foam',    label: 'Пена',   level: 0 },
    { key: 'wax',     label: 'Воск',   level: 0 },
    { key: 'teflon',  label: 'Тефлон', level: 0 }
  ];

  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.mqtt.getPostStatusUpdates().subscribe((msg: any) => {
      const data = msg?.data;
      if (!data?.tanks) return;
      this.tanks = this.tanks.map(t => ({
        ...t,
        level: Math.max(0, Math.min(100, Number(data.tanks[t.key] ?? 0)))
      }));
    });

    // Mock
    this.tanks = [
      { key: 'water',   label: 'Вода',   level: 26 },
      { key: 'osmosis', label: 'Осмос',  level: 20 },
      { key: 'foam',    label: 'Пена',   level: 57 },
      { key: 'wax',     label: 'Воск',   level: 47 },
      { key: 'teflon',  label: 'Тефлон', level: 72 }
    ];
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }
}