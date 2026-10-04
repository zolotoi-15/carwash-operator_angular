import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
@Component({
  selector: 'app-header', standalone: true, imports: [CommonModule],
  template: `<header style="height:60px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;padding:0 24px">
    <div style="font-size:18px;font-weight:500">CarWash Operator</div>
    <div *ngIf="auth.currentUser$ | async as u" style="text-align:right">
      <div style="font-weight:600">{{u.fullName}}</div>
      <div style="font-size:12px;color:#64748b">{{u.group?.displayName}}</div>
    </div>
  </header>`
})
export class HeaderComponent { constructor(public auth: AuthService) {} }
