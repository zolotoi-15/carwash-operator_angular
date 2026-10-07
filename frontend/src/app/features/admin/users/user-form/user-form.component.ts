// src/app/features/admin/users/user-form/user-form.component.ts
import { Component, OnInit, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  UserService,
  AppUser,
  CreateUserDto,
  UpdateUserDto,
  UserRole,
} from '../../../../core/services/user.service';
import { NotificationService } from '../../../../core/services/notification.service';

interface UserFormModel {
  login: string;
  password: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './user-form.component.html',
  styleUrls: ['./user-form.component.scss'],
})
export class UserFormComponent implements OnInit {
  private us = inject(UserService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notify = inject(NotificationService);

  /** id пользователя, если редактируем; null — если создаём */
  userId: string | null = null;
  isEdit = false;

  /** Модель формы */
  m: UserFormModel = {
    login: '',
    password: '',
    fullName: '',
    email: '',
    role: 'operator',
    isActive: true,
  };

  readonly roles: { value: UserRole; label: string }[] = [
    { value: 'admin', label: 'Администратор' },
    { value: 'developer', label: 'Разработчик' },
    { value: 'operator', label: 'Оператор' },
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'new') {
      this.isEdit = true;
      this.userId = id;
      this.loadUser(id);
    }
  }

  private loadUser(id: string): void {
    this.us.getUser(id).subscribe({
      next: (u: AppUser) => {
        this.m = {
          login: u.login,
          password: '',
          fullName: u.fullName,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
        };
      },
      error: (err) => {
        console.error('[user-form] load failed:', err);
        this.notify.error('Не удалось загрузить пользователя');
      },
    });
  }

  save(): void {
    if (!this.m.login || (!this.isEdit && !this.m.password)) {
      this.notify.warning('Заполните логин и пароль');
      return;
    }

    if (this.isEdit && this.userId != null) {
      const dto: UpdateUserDto = {
        fullName: this.m.fullName,
        email: this.m.email,
        role: this.m.role,
        isActive: this.m.isActive,
      };
      if (this.m.password) dto.password = this.m.password;

      this.us.updateUser(this.userId, dto).subscribe({
        next: () => {
          this.notify.success('Пользователь обновлён');
          this.router.navigate(['/admin/users']);
        },
        error: (err) => {
          console.error('[user-form] update failed:', err);
          this.notify.error(err?.error?.error || 'Ошибка обновления');
        },
      });
    } else {
      const dto: CreateUserDto = {
        login: this.m.login,
        password: this.m.password,
        fullName: this.m.fullName,
        email: this.m.email,
        role: this.m.role,
      };
      this.us.createUser(dto).subscribe({
        next: () => {
          this.notify.success('Пользователь создан');
          this.router.navigate(['/admin/users']);
        },
        error: (err) => {
          console.error('[user-form] create failed:', err);
          this.notify.error(err?.error?.error || 'Ошибка создания');
        },
      });
    }
  }

  cancel(): void {
    this.router.navigate(['/admin/users']);
  }
}