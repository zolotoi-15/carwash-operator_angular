import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UserService } from '../../../../core/services/user.service';
import { GroupService } from '../../../../core/services/group.service';
import { User } from '../../../../core/models/user.model';
import { Group } from '../../../../core/models/group.model';
@Component({
  selector: 'app-user-list', standalone: true, imports: [CommonModule, RouterModule],
  template: `<div>
    <h1>👥 Пользователи</h1>
    <button routerLink="/admin/users/create" style="background:#0ea5e9;color:#fff;padding:10px 16px;border:none;border-radius:6px;margin-bottom:16px">+ Добавить</button>
    <table style="width:100%;background:#fff;border-collapse:collapse">
      <thead><tr style="background:#f8fafc"><th style="padding:12px;text-align:left">ID</th><th style="padding:12px;text-align:left">Логин</th><th style="padding:12px;text-align:left">Email</th><th style="padding:12px;text-align:left">ФИО</th><th style="padding:12px;text-align:left">Группа</th></tr></thead>
      <tbody>
        <tr *ngFor="let u of users"><td style="padding:12px">{{u.id}}</td><td style="padding:12px">{{u.username}}</td><td style="padding:12px">{{u.email}}</td><td style="padding:12px">{{u.fullName}}</td><td style="padding:12px">{{groupName(u.groupId)}}</td></tr>
      </tbody>
    </table>
  </div>`
})
export class UserListComponent implements OnInit {
  private us = inject(UserService);
  private gs = inject(GroupService);
  users: User[] = []; groups: Group[] = [];
  ngOnInit(): void {
    this.gs.getGroups().subscribe(g => this.groups = g);
    this.us.getUsers().subscribe(u => this.users = u);
  }
  groupName(id: number): string { return this.groups.find(g => g.id === id)?.displayName ?? '—'; }
}
