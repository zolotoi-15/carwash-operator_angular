import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { AdminService } from '../../core/services/admin.service';
import { KkmStatusComponent } from './kkm-status/kkm-status.component';
import { TankLevelsComponent } from './tank-levels/tank-levels.component';
import { ShiftTotalComponent } from './shift-total/shift-total.component';
import { PostCardComponent } from './post-card/post-card.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    KkmStatusComponent,
    TankLevelsComponent,
    ShiftTotalComponent,
    PostCardComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  auth = inject(AuthService);
  private admin = inject(AdminService);

  postIds: number[] = [];

  ngOnInit(): void {
    this.admin.getSettings().subscribe(settings => {
      const count = settings.numberOfPosts || 8;
      this.postIds = Array.from({ length: count }, (_, i) => i + 1);
    });
  }
}