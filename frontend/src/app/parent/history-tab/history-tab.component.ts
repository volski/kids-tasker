import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParentShellComponent } from '../parent-shell/parent-shell.component';
import { authFetch } from '../../core/utils/auth-fetch';

@Component({
  selector: 'app-history-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './history-tab.component.html',
  styleUrl: './history-tab.component.css'
})
export class HistoryTabComponent implements OnInit {
  availableDates = signal<string[]>([]);
  selectedDate = signal<string>('');
  historyEntries = signal<any[]>([]);

  constructor(private shell: ParentShellComponent) {}

  onImageError(event: Event) {
    (event.target as HTMLImageElement).src = '/icons/star.svg';
  }

  ngOnInit() {
    this.loadHistoryDates();
  }

  async loadHistoryDates() {
    try {
      const res = await authFetch('/api/history');
      const data = await res.json();
      
      const todayStr = new Date().toISOString().split('T')[0];
      const dates = data.availableDates || [];
      if (!dates.includes(todayStr)) {
        dates.unshift(todayStr);
      }

      this.availableDates.set(dates);
      
      if (!this.selectedDate()) {
        this.selectedDate.set(todayStr);
      }
      
      this.loadHistory(this.selectedDate());
    } catch (err) {
      console.error('Error loading history dates:', err);
    }
  }

  async loadHistory(date: string) {
    if (!date) {
      date = new Date().toISOString().split('T')[0];
    }
    this.selectedDate.set(date);
    
    try {
      const res = await authFetch(`/api/history?date=${date}`);
      const data = await res.json();
      this.historyEntries.set(data.history || []);
    } catch (err) {
      console.error('Error loading history for date:', err);
    }
  }

  formatDateDisplay(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return new Intl.DateTimeFormat('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(d);
      }
    } catch (e) {}
    return dateStr;
  }

  formatTime(isoString: string): string {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '-';
    }
  }

  get completedCount() {
    return this.historyEntries().filter(h => h.completed).length;
  }
}
