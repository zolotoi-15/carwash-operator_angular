import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { UserService } from '../../../../core/services/user.service';
import { GroupService } from '../../../../core/services/group.service';
import { User } from '../../../../core/models/user.model';
import { Group } from '../../../../core/models/group.model';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <h2>Пользователи</h2>
    <table style="width:100%; border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left; padding:12px">Логин</th>
          <th style="text-align:left; padding:12px">ФИО</th>
          <th style="text-align:left; padding:12px">Email</th>
          <th style="text-align:left; padding:12px">Группа</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let u of users">
          <td style="padding:12px">{{ u.username }}</td>
          <td style="padding:12px">{{ u.fullName }}</td>
          <td style="padding:12px">{{ u.email }}</td>
          <td style="padding:12px">{{ groupName(u.groupId) }}</td>
        </tr>
      </tbody>
    </table>

    <a routerLink="/admin/users/create" style="display:inline-block; margin-top:16px">
      ➕ Добавить пользователя
    </a>
  `
})
export class UserListComponent implements OnInit {
  users: User[] = [];
  groups: Group[] = [];

  constructor(
    private us: UserService,
    private gs: GroupService
  ) {}

  ngOnInit(): void {
    this.us.getUsers().subscribe((users: User[]) => (this.users = users));
    this.gs.getGroups().subscribe((groups: Group[]) => (this.groups = groups));
  }

  groupName(groupId: number): string {
    return this.groups.find(g => g.id === groupId)?.displayName ?? '—';
  }
}