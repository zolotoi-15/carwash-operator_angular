// src/app/pages/dashboard/tank-levels.component.ts
import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MqttService } from '../../core/servicesmqtt.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-tank-levels',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tanks-section">
      <h3>🛢️ Уровни воды и химии</h3>
      <div class="tanks-horizontal">
        <div *ngFor="let tank of tanksList" class="tank-card-vertical">
          <div class="level-bar-vertical">
            <div class="level-fill-vertical" [style.height.%]="tank.value" [style.background]="getLevelColor(tank.value)"></div>
          </div>
          <div class="tank-label">{{ getTankName(tank.key) }}</div>
          <div class="tank-percent">{{ roundOne(tank.value) }}%</div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }
    .tanks-section {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 16px;
      padding: 12px;
      text-align: center;
      flex: 1;
    }
    .tanks-section h3 { font-size: 1.2rem; margin: 0 0 0.75rem 0; }
    .tanks-horizontal {
      display: flex;
      flex-wrap: wrap;
      gap: 0.8rem;
      justify-content: center;
      align-items: flex-end;
    }
    .tank-card-vertical {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 65px;
    }
    .level-bar-vertical {
      width: 35px;
      height: 100px;
      background-color: rgba(255,255,255,0.2);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      margin-bottom: 6px;
    }
    .level-fill-vertical {
      width: 100%;
      transition: height 0.3s;
    }
    .tank-label { font-weight: bold; font-size: 0.85rem; text-align: center; margin-top: 6px; }
    .tank-percent { font-size: 0.8rem; opacity: 0.9; text-align: center; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TankLevelsComponent implements OnInit, OnDestroy {
  tankLevels: any = {};
  tankNames: any = { water: 'Вода', foam: 'Пена', wax: 'Воск', teflon: 'Тефлон', osmosis: 'Осмос' };
  tankOrder = ['water', 'osmosis', 'foam', 'wax', 'teflon'];
  private subs: Subscription = new Subscription();

  constructor(private mqtt: MqttService, private cdr: ChangeDetectorRef) { }

  get tanksList() {
    return this.tankOrder.map(key => ({ key, value: this.tankLevels[key] || 0 }));
  }

  ngOnInit() {
    this.subs.add(
      this.mqtt.getSystemConfigUpdates().subscribe(config => {
        if (config && config.tankLevels) {
          this.tankLevels = config.tankLevels;
          this.cdr.markForCheck();
        }
      })
    );
  }

  getTankName(key: string): string { return this.tankNames[key] || key; }
  getLevelColor(level: number): string {
    if (level > 70) return '#2ecc71';
    if (level > 30) return '#f39c12';
    return '#e74c3c';
  }
  roundOne(value: number): number { return Math.round(value * 10) / 10; }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}
