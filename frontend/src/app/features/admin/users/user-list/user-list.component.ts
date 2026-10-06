// src/app/features/admin/users/user-list/user-list.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  UserService,
  AppUser,
  CreateUserDto,
  UserRole,
} from '../../../../core/services/user.service';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.scss'],
})
export class UserListComponent implements OnInit {
  private userService = inject(UserService);
  private notify = inject(NotificationService);

  users: AppUser[] = [];
  loading = false;

  /** Форма создания */
  newUser: CreateUserDto = {
    login: '',
    password: '',
    fullName: '',
    email: '',
    role: 'operator',
  };
  showCreateForm = false;

  /** Форма редактирования */
  editingUser: AppUser | null = null;

  readonly roles: { value: UserRole; label: string }[] = [
    { value: 'admin', label: 'Администратор' },
    { value: 'developer', label: 'Разработчик' },
    { value: 'operator', label: 'Оператор' },
  ];

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.loading = true;
    this.userService.list().subscribe({
      next: (list) => {
        this.users = list;
        this.loading = false;
      },
      error: (err) => {
        console.error('[user-list] load failed:', err);
        this.notify.error('Не удалось загрузить пользователей');
        this.loading = false;
      },
    });
  }

  // ================== СОЗДАНИЕ ==================
  toggleCreateForm(): void {
    this.showCreateForm = !this.showCreateForm;
    if (!this.showCreateForm) this.resetCreateForm();
  }

  createUser(): void {
    const dto = this.newUser;
    if (!dto.login || !dto.password) {
      this.notify.warning('Логин и пароль обязательны');
      return;
    }
    this.userService.create(dto).subscribe({
      next: (created) => {
        this.notify.success(`Пользователь ${created.login} создан`);
        this.showCreateForm = false;
        this.resetCreateForm();
        this.loadUsers();
      },
      error: (err) => {
        console.error('[user-list] create failed:', err);
        this.notify.error(err?.error?.error || 'Ошибка создания');
      },
    });
  }

  resetCreateForm(): void {
    this.newUser = {
      login: '',
      password: '',
      fullName: '',
      email: '',
      role: 'operator',
    };
  }

  // ================== РЕДАКТИРОВАНИЕ ==================
  startEdit(user: AppUser): void {
    this.editingUser = { ...user };
  }

  cancelEdit(): void {
    this.editingUser = null;
  }

  saveEdit(): void {
    if (!this.editingUser) return;
    const { _id, fullName, email, role, isActive } = this.editingUser;
    this.userService.update(_id, { fullName, email, role, isActive }).subscribe({
      next: () => {
        this.notify.success('Пользователь обновлён');
        this.editingUser = null;
        this.loadUsers();
      },
      error: (err) => {
        console.error('[user-list] update failed:', err);
        this.notify.error(err?.error?.error || 'Ошибка обновления');
      },
    });
  }

  // ================== УДАЛЕНИЕ ==================
  removeUser(user: AppUser): void {
    if (!confirm(`Удалить пользователя ${user.login}?`)) return;
    this.userService.remove(user._id).subscribe({
      next: () => {
        this.notify.success(`Пользователь ${user.login} удалён`);
        this.users = this.users.filter(u => u._id !== user._id);
      },
      error: (err) => {
        console.error('[user-list] delete failed:', err);
        this.notify.error(err?.error?.error || 'Ошибка удаления');
      },
    });
  }

  // ================== Утилиты ==================
  roleLabel(role: UserRole): string {
    return this.roles.find(r => r.value === role)?.label ?? role;
  }

  trackById(_i: number, u: AppUser): string {
    return u._id;
  }
}