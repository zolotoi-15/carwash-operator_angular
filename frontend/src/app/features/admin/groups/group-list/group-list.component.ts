import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GroupService } from '../../../../core/services/group.service';
import { Group } from '../../../../core/models/group.model';
@Component({
  selector: 'app-group-list', standalone: true, imports: [CommonModule],
  template: `<div><h1>👥 Группы</h1>
    <table style="width:100%;background:#fff;border-collapse:collapse">
      <thead><tr style="background:#f8fafc"><th style="padding:12px;text-align:left">ID</th><th style="padding:12px;text-align:left">Название</th><th style="padding:12px;text-align:left">Системное имя</th><th style="padding:12px;text-align:left">Описание</th></tr></thead>
      <tbody><tr *ngFor="let g of groups"><td style="padding:12px">{{g.id}}</td><td style="padding:12px">{{g.displayName}}</td><td style="padding:12px"><code>{{g.name}}</code></td><td style="padding:12px">{{g.description}}</td></tr></tbody>
    </table>
  </div>`
})
export class GroupListComponent implements OnInit {
  private gs = inject(GroupService);
  groups: Group[] = [];
  ngOnInit(): void { this.gs.getGroups().subscribe(g => this.groups = g); }
}
