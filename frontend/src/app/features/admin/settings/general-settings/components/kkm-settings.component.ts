import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';

@Component({
  selector: 'app-kkm-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form *ngIf="form" [formGroup]="form" (ngSubmit)="save()">
      <h3>🤖 Автоматические настройки (АТОЛ/Штрих-М)</h3>
      <label class="checkbox-label">
        <input type="checkbox" formControlName="enabled"> Включить ККМ
      </label>
      <label class="checkbox-label">
        <input type="checkbox" formControlName="mockReceipt"> Печать чека (симуляция)
      </label>

      <h3>✍️ Ручные настройки (если драйвер не отдаёт данные)</h3>
      <div class="manual-fields">
        <label>Номер ККТ: <input formControlName="kkNumber" placeholder="0000111118041361"></label>
        <label>Номер фискальной смены: <input formControlName="fiscalShiftNumber" type="number"></label>
        <label>Имя кассира: <input formControlName="cashierName" placeholder="Иванов И.И."></label>
      </div>

      <div class="info-block">
        <p>ℹ️ При выключенном ККМ чеки не будут отправляться на печать.</p>
        <p>ℹ️ Режим симуляции печатает чек в файл вместо реального принтера.</p>
        <p>📌 Если драйвер не подключён, будут использоваться ручные значения.</p>
      </div>
      <button type="submit" class="save-btn">💾 Сохранить</button>
    </form>
    <div *ngIf="!form" class="loading">Загрузка...</div>
  `,
  styles: [`
    .checkbox-label { display: block; margin: 0.8rem 0; font-size: 1rem; }
    .checkbox-label input { margin-right: 10px; transform: scale(1.2); vertical-align: middle; }
    .manual-fields { display: flex; flex-direction: column; gap: 0.5rem; margin: 1rem 0; }
    .manual-fields label { display: flex; justify-content: space-between; align-items: center; max-width: 300px; }
    .manual-fields input { padding: 6px; border-radius: 8px; border: 1px solid #ccc; width: 200px; }
    .info-block { background: #eef2f7; padding: 0.8rem; border-radius: 12px; margin: 1rem 0; font-size: 0.85rem; color: #2c3e50; }
    .save-btn { background: #27ae60; color: white; border: none; padding: 8px 16px; border-radius: 30px; cursor: pointer; font-size: 1rem; margin-top: 0.5rem; }
    .loading { text-align: center; color: #666; }
  `]
})
export class KkmSettingsComponent implements OnInit {
  form!: FormGroup;

  constructor(private admin: AdminService, private fb: FormBuilder) { }

  ngOnInit() {
    this.admin.getSettings().subscribe(settings => {
      this.form = this.fb.group({
        enabled: [settings.kkm?.enabled ?? true],
        mockReceipt: [settings.kkm?.mockReceipt ?? true],
        kkNumber: [settings.kkmManual?.kkNumber || ""],
        fiscalShiftNumber: [settings.kkmManual?.fiscalShiftNumber || null],
        cashierName: [settings.kkmManual?.cashierName || ""]
      });
    });
  }

  save() {
    const kkm = {
      enabled: this.form.value.enabled,
      mockReceipt: this.form.value.mockReceipt
    };
    const kkmManual = {
      kkNumber: this.form.value.kkNumber,
      fiscalShiftNumber: this.form.value.fiscalShiftNumber,
      cashierName: this.form.value.cashierName
    };
    this.admin.updateSettings({ kkm, kkmManual }).subscribe(() => alert('Настройки ККМ сохранены'));
  }
}
