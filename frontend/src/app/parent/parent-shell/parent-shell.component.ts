import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { SocketService } from '../../services/socket.service';
import { authFetch } from '../../core/utils/auth-fetch';
import { TaskService } from '../../services/task.service';
import { PwaService } from '../../services/pwa.service';
import { PinModalComponent } from '../../shared/pin-modal/pin-modal.component';
import { ConfirmModalComponent } from '../../shared/confirm-modal/confirm-modal.component';

import { FirebaseAuthService } from '../../core/services/firebase-auth.service';
import { HouseholdService } from '../../services/household.service';

@Component({
  selector: 'app-parent-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, PinModalComponent, ConfirmModalComponent],
  templateUrl: './parent-shell.component.html',
  styleUrl: './parent-shell.component.css'
})
export class ParentShellComponent implements OnInit, OnDestroy {
  activeTab = signal('status');
  isConnected = signal(false);
  showPinModal = signal(false);
  showResetConfirm = signal(false);
  isUnlocked = signal(false);
  toastMessage = signal<string | null>(null);
  toastType = signal<'success' | 'error'>('success');
  showIosHint = false;

  private socketSub?: Subscription;
  private socketDeltaSub?: Subscription;
  private householdSocketSub?: Subscription;
  private householdDeletedSub?: Subscription;
  private routerSub?: Subscription;
  private toastTimer: any;

  constructor(
    private router: Router,
    private socketService: SocketService,
    private taskService: TaskService,
    public pwa: PwaService,
    public authService: FirebaseAuthService,
    public householdService: HouseholdService
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
    this.householdService.getMyHousehold().subscribe();

    this.socketSub = this.socketService.onTaskUpdated.subscribe((data) => {
      // Data update is handled by the services, but we ensure connection state is updated
      this.isConnected.set(this.socketService.connected);
      this.taskService.fullData.set(data);
      this.taskService.appData.set(data.children || []);
    });

    this.socketDeltaSub = this.socketService.onTaskDelta.subscribe((delta) => {
      this.taskService.applyTaskDelta(delta);
    });

    this.householdSocketSub = this.socketService.onHouseholdUpdated.subscribe((info) => {
      const currentUid = this.authService.currentUser?.uid;
      if (info && currentUid) {
        const isMember = (info.members || []).includes(currentUid);
        const isPending = (info.pendingMembers || []).includes(currentUid);
        const isOwner = info.ownerUid === currentUid;
        if (!isMember && !isPending && !isOwner) {
          // User was removed from family!
          this.showToast('הוסרת ממערכת המשפחה. כעת תוכל ליצור או להצטרף למשפחה חדשה.', 'error');
          localStorage.removeItem('kids_tasker_household_id');
          this.householdService.getMyHousehold().subscribe();
          this.taskService.loadData().subscribe();
          return;
        }
      }
      this.householdService.currentHousehold.set(info);
      this.taskService.loadData().subscribe();
    });

    this.householdDeletedSub = this.socketService.onHouseholdDeleted.subscribe(() => {
      this.showToast('המשפחה נמחקה על ידי מנהל המשפחה.', 'error');
      localStorage.removeItem('kids_tasker_household_id');
      this.householdService.getMyHousehold().subscribe();
      this.taskService.loadData().subscribe();
    });

    setInterval(() => {
      this.isConnected.set(this.socketService.connected);
    }, 1000);
  }

  ngOnDestroy() {
    this.socketSub?.unsubscribe();
    this.socketDeltaSub?.unsubscribe();
    this.householdSocketSub?.unsubscribe();
    this.householdDeletedSub?.unsubscribe();
    this.routerSub?.unsubscribe();
  }

  refreshPendingHousehold() {
    this.householdService.getMyHousehold().subscribe();
  }

  cancelPendingHouseholdRequest() {
    if (!confirm('האם אתה בטוח שברצונך לבטל את בקשת ההצטרפות?')) return;
    this.householdService.leaveHousehold().subscribe();
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

  promptResetDay() {
    this.showResetConfirm.set(true);
  }

  async executeResetDay() {
    this.showResetConfirm.set(false);
    try {
      await authFetch('/api/tasks/reset-day', { method: 'POST' });
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
      return 'whitespace-nowrap flex-shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-indigo-600 text-white shadow-md';
    }
    return 'whitespace-nowrap flex-shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-slate-800/80 text-slate-300 hover:bg-slate-800';
  }

  async logoutUser() {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
