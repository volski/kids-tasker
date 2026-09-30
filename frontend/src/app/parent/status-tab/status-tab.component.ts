import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TaskService } from '../../services/task.service';
import { ParentShellComponent } from '../parent-shell/parent-shell.component';
import { authFetch } from '../../core/utils/auth-fetch';

@Component({
  selector: 'app-status-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './status-tab.component.html',
  styleUrl: './status-tab.component.css'
})
export class StatusTabComponent implements OnInit {
  taskService = inject(TaskService);
  shell = inject(ParentShellComponent);

  currentDate = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  children = this.taskService.appData;

  overallStats = computed(() => {
    let totalTasks = 0;
    let completedTasks = 0;
    const kids = this.taskService.appData() || [];

    kids.forEach(c => {
      const enabledT = c.tasks.filter(t => t.enabled !== false);
      totalTasks += enabledT.length;
      completedTasks += enabledT.filter(t => t.completed).length;
    });

    const overallPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const allDone = totalTasks > 0 && completedTasks === totalTasks;
    
    // We don't have direct access to appData.homeAssistant.parentBypass in the children array alone,
    // so we need a way to get bypass status. Let's fetch the full data via service or assume it from somewhere.
    // For now we'll fetch full data to guarantee we have it.
    
    return {
      totalTasks,
      completedTasks,
      overallPct,
      allDone
    };
  });

  isBypass = computed(() => {
    return Boolean(this.taskService.fullData()?.homeAssistant?.parentBypass);
  });

  isTvAllowed = computed(() => {
    return this.overallStats().allDone || this.isBypass();
  });

  onImageError(event: Event) {
    (event.target as HTMLImageElement).src = '/icons/star.svg';
  }

  ngOnInit() {
    this.taskService.loadData().subscribe();
  }

  formatTime(isoString: string | null | undefined): string {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '-';
    }
  }

  async toggleTaskFromParent(childId: string, taskId: string) {
    try {
      await authFetch('/api/tasks/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId, taskId, isParent: true })
      });
      // socket will update data
    } catch (err: any) {
      this.shell.showToast('שגיאה בעדכון משימה: ' + err.message, 'error');
    }
  }

  async handleApproveTask(childId: string, taskId: string) {
    try {
      const res = await authFetch('/api/tasks/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId, taskId })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        throw new Error(err.error || 'Failed');
      }
      this.shell.showToast('המשימה אושרה בהצלחה! ✓', 'success');
    } catch (err: any) {
      this.shell.showToast('שגיאה באישור משימה: ' + err.message, 'error');
    }
  }

  getChildStats(child: any) {
    const enabledTasks = child.tasks.filter((t: any) => t.enabled !== false);
    const total = enabledTasks.length;
    const done = enabledTasks.filter((t: any) => t.completed).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const isFinished = total > 0 && done === total;
    return { enabledTasks, total, done, pct, isFinished };
  }
}
