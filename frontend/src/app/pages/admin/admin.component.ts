import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PricesComponent } from './components/prices.component';
import { FrequenciesComponent } from './components/frequencies.component';
import { RelaysComponent } from './components/relays.component';
import { DelaysComponent } from './components/delays.component';
import { ButtonsComponent } from './components/buttons.component';
import { TanksComponent } from './components/tanks.component';
import { KkmSettingsComponent } from './components/kkm-settings.component';
import { CamerasComponent } from './components/cameras.component';
import { ServicesComponent } from './components/services.component';
import { AdminService } from '../../services/admin.service';
import { MqttSettingsComponent } from './components/mqtt-settings.component';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    PricesComponent,
    FrequenciesComponent,
    RelaysComponent,
    DelaysComponent,
    ButtonsComponent,
    TanksComponent,
    KkmSettingsComponent,
    CamerasComponent,
    ServicesComponent,
    MqttSettingsComponent
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent {
  publishSuccess = false;
  publishError = false;

  // Для копирования
  copySuccess = false;
  copyError = false;

  constructor(private admin: AdminService) { }

  publishConfig() {
    this.publishSuccess = false;
    this.publishError = false;
    this.admin.publishConfig().subscribe({
      next: () => {
        this.publishSuccess = true;
        setTimeout(() => this.publishSuccess = false, 3000);
      },
      error: () => {
        this.publishError = true;
        setTimeout(() => this.publishError = false, 3000);
      }
    });
  }

  // Новый метод для копирования
  copySettingsFromPost1() {
    this.copySuccess = false;
    this.copyError = false;
    this.admin.copySettingsFromPost1ToAll().subscribe({
      next: () => {
        this.copySuccess = true;
        setTimeout(() => this.copySuccess = false, 3000);
      },
      error: () => {
        this.copyError = true;
        setTimeout(() => this.copyError = false, 3000);
      }
    });
  }
}
