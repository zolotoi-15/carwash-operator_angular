import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.css']
})
export class ReportsComponent {
  report: any = null;
  fromDate: string = '';
  toDate: string = '';

  constructor(private http: HttpClient) { }

  loadReport(type: string) {
    let url = '/api/reports/';
    if (type === 'day') {
      const today = new Date().toISOString().split('T')[0];
      url += `day/${today}`;
    } else if (type === 'week') url += 'week';
    else if (type === 'month') url += 'month';
    else if (type === 'shift') url += 'shift';
    else if (type === 'range') url += `range?from=${this.fromDate}&to=${this.toDate}`;
    else return;
    this.http.get(url).subscribe((data: any) => {
      if (data && data.receipts) {
        data.totalSum = this.roundOne(data.totalSum);
        data.receipts = data.receipts.map((r: any) => ({
          ...r,
          totalCost: this.roundOne(r.totalCost),
          items: r.items.map((i: any) => ({ ...i, seconds: this.roundOne(i.seconds), cost: this.roundOne(i.cost) }))
        }));
      }
      this.report = data;
    });
  }

  async downloadPDF() {
    if (!this.fromDate || !this.toDate) {
      alert('Выберите диапазон дат');
      return;
    }
    const token = localStorage.getItem('jwt_token');
    if (!token) {
      alert('Ошибка авторизации');
      return;
    }
    const url = `/api/reports/pdf?from=${this.fromDate}&to=${this.toDate}`;
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Ошибка загрузки PDF');
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      console.error(error);
      alert('Не удалось загрузить PDF');
    }
  }

  roundOne(value: number): number {
    if (value === undefined || value === null) return 0;
    return Math.round(value * 10) / 10;
  }
}
