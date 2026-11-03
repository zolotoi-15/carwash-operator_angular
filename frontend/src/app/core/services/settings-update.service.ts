import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettingsUpdateService {
  private settingsUpdatedSource = new Subject<void>();

  /** Публичный поток — на него подписываются компоненты */
  settingsUpdated$ = this.settingsUpdatedSource.asObservable();

  /** Вызывается после успешного сохранения настроек */
  notifySettingsUpdated(): void {
    this.settingsUpdatedSource.next();
  }
}