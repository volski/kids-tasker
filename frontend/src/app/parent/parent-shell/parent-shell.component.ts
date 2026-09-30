import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { SocketService } from '../../services/socket.service';
import { TaskService } from '../../services/task.service';
import { PinModalComponent } from '../../shared/pin-modal/pin-modal.component';

@Component({
  selector: 'app-parent-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, PinModalComponent],
  templateUrl: './parent-shell.component.html',
  styleUrl: './parent-shell.component.css'
})
export class ParentShellComponent implements OnInit, OnDestroy {
  activeTab = signal('status');
  isConnected = signal(false);
  showPinModal = signal(false);
  isUnlocked = signal(false);
  toastMessage = signal<string | null>(null);
  toastType = signal<'success' | 'error'>('success');
  
  private socketSub?: Subscription;
  private routerSub?: Subscription;
  private toastTimer: any;

  constructor(
    private router: Router,
    private socketService: SocketService,
    private taskService: TaskService
  ) {
    this.routerSub = this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe((e: any) => {
      const url = e.urlAfterRedirects || e.url;
      const parts = url.split('/');
      this.activeTab.set(parts[parts.length - 1] || 'status');
    });
  }

  ngOnInit() {
    this.checkAccess();

    this.socketSub = this.socketService.onTaskUpdated.subscribe(() => {
      // Data update is handled by the services, but we ensure connection state is updated
      this.isConnected.set(this.socketService.connected);
    });

    setInterval(() => {
      this.isConnected.set(this.socketService.connected);
    }, 1000);
  }

  ngOnDestroy() {
    this.socketSub?.unsubscribe();
    this.routerSub?.unsubscribe();
  }

  checkAccess() {
    if (sessionStorage.getItem('kids_tasker_parent_unlocked') === '1') {
      this.isUnlocked.set(true);
    } else {
      this.showPinModal.set(true);
    }
  }

  onPinVerified() {
    this.isUnlocked.set(true);
    this.showPinModal.set(false);
  }

  onPinClosed() {
    // If they cancel PIN verify in parent area, kick them back to kids board
    if (!this.isUnlocked()) {
      this.router.navigate(['/']);
    }
    this.showPinModal.set(false);
  }

  lockParentDashboard() {
    sessionStorage.removeItem('kids_tasker_parent_unlocked');
    this.isUnlocked.set(false);
    this.router.navigate(['/']);
  }

  reconnectSocket() {
    if (!this.socketService.connected) {
      this.socketService.connect();
    }
  }

  async confirmResetDay() {
    if (!confirm('האם לאפס את סימוני כל המשימות ליום חדש?\\n(שימו לב: שמות הילדים, המשימות וההיסטוריה נשמרים כרגיל!)')) return;
    
    try {
      await fetch('/api/tasks/reset-day', { method: 'POST' });
      this.showToast('משימות היום אופסו ליום חדש! כל השמות וההיסטוריה נשמרו ✓', 'success');
    } catch (err: any) {
      this.showToast('שגיאה באיפוס משימות: ' + err.message, 'error');
    }
  }

  showToast(message: string, type: 'success' | 'error' = 'success') {
    this.toastMessage.set(message);
    this.toastType.set(type);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage.set(null);
    }, 2800);
  }

  getTabClass(tab: string) {
    if (this.activeTab() === tab) {
      return 'px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-indigo-600 text-white shadow-md';
    }
    return 'px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-slate-800/80 text-slate-300 hover:bg-slate-800';
  }
}
