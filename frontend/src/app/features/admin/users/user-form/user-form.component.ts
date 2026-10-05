import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { UserService } from '../../../../core/services/user.service';
import { GroupService } from '../../../../core/services/group.service';
import { Group } from '../../../../core/models/group.model';
@Component({
  selector: 'app-user-form', standalone: true, imports: [CommonModule, FormsModule, RouterModule],
  template: `<div>
    <h1>{{isEdit ? 'Редактирование' : 'Новый пользователь'}}</h1>
    <form (ngSubmit)="onSubmit()" style="background:#fff;padding:24px;border-radius:8px;max-width:600px">
      <div style="margin-bottom:16px"><label>Логин</label><input [(ngModel)]="m.username" name="u" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px"/></div>
      <div style="margin-bottom:16px"><label>Email</label><input [(ngModel)]="m.email" name="e" type="email" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px"/></div>
      <div style="margin-bottom:16px"><label>ФИО</label><input [(ngModel)]="m.fullName" name="f" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px"/></div>
      <div style="margin-bottom:16px"><label>Пароль</label><input [(ngModel)]="m.password" name="p" type="password" [required]="!isEdit" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px"/></div>
      <div style="margin-bottom:16px"><label>Группа</label>
        <select [(ngModel)]="m.groupId" name="g" required style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px">
          <option *ngFor="let g of groups" [ngValue]="g.id">{{g.displayName}}</option>
        </select>
      </div>
      <div style="margin-bottom:16px"><label><input type="checkbox" [(ngModel)]="m.isActive" name="a"/> Активен</label></div>
      <button type="submit" style="background:#0ea5e9;color:#fff;padding:10px 20px;border:none;border-radius:6px;cursor:pointer">Сохранить</button>
      <a routerLink="/admin/users" style="margin-left:12px">Отмена</a>
    </form>
  </div>`
})
export class UserFormComponent implements OnInit {
  private us = inject(UserService);
  private gs = inject(GroupService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  groups: Group[] = []; isEdit = false; userId?: number;
  m = { username: '', email: '', fullName: '', password: '', groupId: 0, isActive: true };
  ngOnInit(): void {
    this.gs.getGroups().subscribe(g => this.groups = g);
    const id = this.route.snapshot.paramMap.get('id');
    if (id) { this.isEdit = true; this.userId = +id; this.us.getUser(this.userId).subscribe(u => this.m = { ...u, password: '' } as any); }
  }
  onSubmit(): void {
    if (this.isEdit && this.userId) {
      const dto: any = { ...this.m }; if (!dto.password) delete dto.password;
      this.us.updateUser(this.userId, dto).subscribe(() => this.router.navigate(['/admin/users']));
    } else {
      this.us.createUser(this.m as any).subscribe(() => this.router.navigate(['/admin/users']));
    }
  }
}
