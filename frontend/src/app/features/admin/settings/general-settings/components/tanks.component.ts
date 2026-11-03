import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../../../core/services/admin.service';

@Component({
  selector: 'app-tanks',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form *ngIf="form" [formGroup]="form" (ngSubmit)="save()">
      <h3>📊 Уровни в бочках (%)</h3>
      <div class="two-columns">
        <label>💧 Вода: <input formControlName="water_level" type="number" min="0" max="100" step="5"></label>
        <label>🧼 Пена: <input formControlName="foam_level" type="number" min="0" max="100" step="5"></label>
        <label>✨ Воск: <input formControlName="wax_level" type="number" min="0" max="100" step="5"></label>
        <label>🛡️ Тефлон: <input formControlName="teflon_level" type="number" min="0" max="100" step="5"></label>
        <label>💦 Осмос: <input formControlName="osmosis_level" type="number" min="0" max="100" step="5"></label>
      </div>
      <h3>⚠️ Пороги низкого уровня (%)</h3>
      <div class="two-columns">
        <label>💧 Вода: <input formControlName="water_threshold" type="number" min="0" max="100" step="5"></label>
        <label>🧼 Пена: <input formControlName="foam_threshold" type="number" min="0" max="100" step="5"></label>
        <label>✨ Воск: <input formControlName="wax_threshold" type="number" min="0" max="100" step="5"></label>
        <label>🛡️ Тефлон: <input formControlName="teflon_threshold" type="number" min="0" max="100" step="5"></label>
        <label>💦 Осмос: <input formControlName="osmosis_threshold" type="number" min="0" max="100" step="5"></label>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
    <div *ngIf="!form" class="loading">Загрузка...</div>
  `,
  styles: [`
    .two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
    label { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    input { width: 80px; padding: 6px; border-radius: 8px; border: 1px solid #ccc; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 30px; cursor: pointer; margin-top: 1rem; }
    .loading { text-align: center; color: #666; }
  `]
})
export class TanksComponent implements OnInit {
  form!: FormGroup;

  constructor(private admin: AdminService, private fb: FormBuilder) {}

  ngOnInit(): void {
    this.admin.getSettings().subscribe(settings => {
      this.form = this.fb.group({
        water_level: [settings.tankLevels?.['water'] || 80],
        foam_level: [settings.tankLevels?.['foam'] || 65],
        wax_level: [settings.tankLevels?.['wax'] || 45],
        teflon_level: [settings.tankLevels?.['teflon'] || 90],
        osmosis_level: [settings.tankLevels?.['osmosis'] || 30],
        water_threshold: [settings.tankLowThreshold?.['water'] || 20],
        foam_threshold: [settings.tankLowThreshold?.['foam'] || 15],
        wax_threshold: [settings.tankLowThreshold?.['wax'] || 10],
        teflon_threshold: [settings.tankLowThreshold?.['teflon'] || 25],
        osmosis_threshold: [settings.tankLowThreshold?.['osmosis'] || 10]
      });
    });
  }

  save(): void {
    const raw = this.form.value;
    const newLevels = {
      water: raw.water_level, foam: raw.foam_level, wax: raw.wax_level,
      teflon: raw.teflon_level, osmosis: raw.osmosis_level
    };
    const newThresholds = {
      water: raw.water_threshold, foam: raw.foam_threshold, wax: raw.wax_threshold,
      teflon: raw.teflon_threshold, osmosis: raw.osmosis_threshold
    };
    this.admin.updateSettings({ tankLevels: newLevels, tankLowThreshold: newThresholds } as any)
      .subscribe(() => alert('Уровни и пороги сохранены'));
  }
}