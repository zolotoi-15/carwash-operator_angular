import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Group, CreateGroupDto } from '../models/group.model';

@Injectable({ providedIn: 'root' })
export class GroupService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/groups`;

  // MOCK-данные на время, пока API не готов
  private mockGroups: Group[] = [
    { id: 1, name: 'administrator' as any, displayName: 'Администратор' },
    { id: 2, name: 'developer' as any, displayName: 'Разработчик' },
    { id: 3, name: 'operator' as any, displayName: 'Оператор' }
  ];

  getGroups(): Observable<Group[]> {
    // Когда API будет готов — раскомментируйте:
    // return this.http.get<Group[]>(this.apiUrl);
    return of(this.mockGroups);
  }

  getGroup(id: number): Observable<Group> {
    return of(this.mockGroups.find(g => g.id === id)!);
    // return this.http.get<Group>(`${this.apiUrl}/${id}`);
  }

  createGroup(dto: CreateGroupDto): Observable<Group> {
    const newGroup: Group = { id: this.mockGroups.length + 1, ...dto };
    this.mockGroups.push(newGroup);
    return of(newGroup);
    // return this.http.post<Group>(this.apiUrl, dto);
  }

  updateGroup(id: number, dto: Partial<CreateGroupDto>): Observable<Group> {
    const idx = this.mockGroups.findIndex(g => g.id === id);
    this.mockGroups[idx] = { ...this.mockGroups[idx], ...dto };
    return of(this.mockGroups[idx]);
    // return this.http.put<Group>(`${this.apiUrl}/${id}`, dto);
  }

  deleteGroup(id: number): Observable<void> {
    this.mockGroups = this.mockGroups.filter(g => g.id !== id);
    return of(void 0);
    // return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}