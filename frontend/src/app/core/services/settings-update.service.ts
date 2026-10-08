import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettingsUpdateService {
  // Источник событий об обновлении настроек
  private settingsUpdatedSource = new Subject<void>();

  // Публичный Observable, на который могут подписываться компоненты
  settingsUpdated$ = this.settingsUpdatedSource.asObservable();

  // Метод, который вызывается для уведомления всех подписчиков
  notifySettingsUpdated(): void {
    this.settingsUpdatedSource.next();
  }
}