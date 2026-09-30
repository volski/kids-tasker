import {
  Component, OnInit, OnDestroy, signal, computed,
  HostListener, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { TaskService } from '../services/task.service';
import { SocketService } from '../services/socket.service';
import { PwaService } from '../services/pwa.service';
import { AppData, Child, Task, AudioPreset } from '../models/task.model';
import { PinModalComponent } from '../shared/pin-modal/pin-modal.component';

const CHILD_COLORS = [
  { bg: 'from-blue-600 to-indigo-700',   text: 'text-indigo-200', border: 'border-indigo-500/30' },
  { bg: 'from-purple-600 to-pink-700',   text: 'text-pink-200',   border: 'border-pink-500/30'   },
  { bg: 'from-amber-600 to-orange-700',  text: 'text-amber-200',  border: 'border-amber-500/30'  },
  { bg: 'from-emerald-600 to-teal-700',  text: 'text-teal-200',   border: 'border-teal-500/30'   },
];

interface ChildView {
  child: Child;
  theme: typeof CHILD_COLORS[0];
  enabledTasks: Task[];
  total: number;
  completed: number;
  percentage: number;
  isAllDone: boolean;
}

@Component({
  selector: 'app-kids-board',
  standalone: true,
  imports: [CommonModule, PinModalComponent],
  templateUrl: './kids-board.component.html',
  styleUrl: './kids-board.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KidsBoardComponent implements OnInit, OnDestroy {
  loading = signal(true);
  data = signal<AppData | null>(null);
  isConnected = signal(false);
  isAudioPlaying = signal(false);
  pinModalOpen = signal(false);
  toastMessage = signal('');

  private pendingToggles = new Set<string>();
  private pendingAudioCounts: Record<string, number> = {};
  private currentAudio: HTMLAudioElement | null = null;
  private safetyTimer: any = null;
  private socketSub?: Subscription;
  private socketDeltaSub?: Subscription;
  private toastTimer: any;
  private pullStartY = 0;
  private pulling = false;
  showIosHint = false;

  readonly hebrewDate: string;

  constructor(
    private taskService: TaskService,
    private socketService: SocketService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    public pwa: PwaService,
  ) {
    try {
      this.hebrewDate = new Intl.DateTimeFormat('he-IL', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }).format(new Date());
    } catch {
      this.hebrewDate = new Date().toLocaleDateString('he-IL');
    }
  }

  ngOnInit(): void {
    this.fetchTasks();
    this.socketSub = this.socketService.onTaskUpdated.subscribe(data => {
      this.data.set(data);
      this.loading.set(false);
      this.cdr.markForCheck();
    });

    this.socketDeltaSub = this.socketService.onTaskDelta.subscribe(delta => {
      this.data.update(full => {
        if (!full || !full.children) return full;
        return {
          ...full,
          children: full.children.map(c => {
            if (c.id !== delta.childId) return c;
            return {
              ...c,
              tasks: c.tasks.map(t => {
                if (t.id !== delta.taskId) return t;
                return { ...t, ...delta.changes };
              })
            };
          })
        };
      });
      this.cdr.markForCheck();
    });

    // Connection status
    const checkConn = () => {
      this.isConnected.set(this.socketService.connected);
      this.cdr.markForCheck();
    };
    setInterval(checkConn, 1000);
  }

  ngOnDestroy(): void {
    this.socketSub?.unsubscribe();
    this.socketDeltaSub?.unsubscribe();
    this.stopAudio();
  }

  // ─── Data helpers ───────────────────────────────────────────────────────────

  get childViews(): ChildView[] {
    const d = this.data();
    if (!d?.children?.length) return [];
    return d.children.map((child, i) => {
      const theme = CHILD_COLORS[i % CHILD_COLORS.length];
      const enabledTasks = child.tasks.filter(t => t.enabled !== false);
      const total = enabledTasks.length;
      const completed = enabledTasks.filter(t => t.completed).length;
      const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
      const isAllDone = total > 0 && completed === total;
      return { child, theme, enabledTasks, total, completed, percentage, isAllDone };
    });
  }

  get tvBadge(): { cls: string; icon: string; label: string } | null {
    const d = this.data();
    if (!d?.children?.length) return null;
    let total = 0, completed = 0;
    d.children.forEach(c => {
      const et = c.tasks.filter(t => t.enabled !== false);
      total += et.length;
      completed += et.filter(t => t.completed).length;
    });
    const allDone = total > 0 && completed === total;
    const isBypass = Boolean(d.homeAssistant?.parentBypass);

    if (allDone) return {
      cls: 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 shadow-sm animate-pulse',
      icon: '📺', label: 'טלוויזיה מותרת! 🎉'
    };
    if (isBypass) return {
      cls: 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-purple-950/80 border border-purple-700/80 text-purple-300 shadow-sm animate-pulse',
      icon: '🔓', label: 'טלוויזיה מותרת (מעקף הורים)'
    };
    return {
      cls: 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-rose-950/80 border border-rose-800/80 text-rose-300 shadow-sm',
      icon: '🔒', label: `טלוויזיה חסומה (${total - completed} נותרו)`
    };
  }

  taskCardBg(task: Task): string {
    if (task.completed) return 'bg-emerald-600 hover:bg-emerald-600 cursor-default opacity-95';
    if (task.pendingApproval) return 'bg-amber-600 hover:bg-amber-500 cursor-pointer active:scale-[0.98]';
    return 'bg-rose-700 hover:bg-rose-600 cursor-pointer active:scale-[0.98]';
  }

  taskBadgeStyle(task: Task): string {
    if (task.completed) return 'bg-emerald-800/70 border-emerald-400/40 text-emerald-100';
    if (task.pendingApproval) return 'bg-amber-800/80 border-amber-300/40 text-amber-100';
    return 'bg-rose-900/70 border-rose-400/40 text-rose-100';
  }

  taskStatusText(task: Task): string {
    if (task.completed) return 'בוצע ✔ 🔒';
    if (task.pendingApproval) return 'ממתין לאישור הורה ⏳';
    return 'טרם בוצע ❌';
  }

  taskTitleClass(task: Task): string {
    return task.completed
      ? 'text-lg sm:text-xl font-bold tracking-tight truncate leading-tight line-through decoration-white/60 text-white/90'
      : 'text-lg sm:text-xl font-bold tracking-tight truncate leading-tight text-white';
  }

  formatTime(iso: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  trackByChildId(_: number, cv: ChildView): string { return cv.child.id; }
  trackByTaskId(_: number, t: Task): string { return t.id; }

  // ─── Task interaction ────────────────────────────────────────────────────────

  toggleTask(childId: string, taskId: string): void {
    if (this.isAudioPlaying()) {
      this.shakeCard(childId, taskId);
      return;
    }

    const key = `${childId}_${taskId}`;
    const d = this.data();
    if (!d) return;

    const child = d.children.find(c => c.id === childId);
    const task = child?.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (task.completed) {
      this.showToast('המשימה כבר בוצעה! רק הורים יכולים לבטל משימה שבוצעה 🔒');
      return;
    }

    if (task.pendingApproval) {
      this.showToast('המשימה כבר נשלחה וממתינה לאישור הורה ⏳');
      const count = this.pendingAudioCounts[key] || 1;
      if (count < 3 && task.audioFeedback) {
        this.pendingAudioCounts[key] = count + 1;
        this.playAudio(task.audioFeedback, d);
      }
      return;
    }

    if (this.pendingToggles.has(key)) return;
    this.pendingToggles.add(key);

    // Optimistic update
    const feedback = task.audioFeedback || '';
    if (task.requiresApproval) {
      task.pendingApproval = true;
      this.pendingAudioCounts[key] = 1;
    } else {
      task.completed = true;
      task.completedAt = new Date().toISOString();
    }
    this.data.set({ ...d });

    if (feedback) this.playAudio(feedback, d);

    this.taskService.toggleTask(childId, taskId, false).subscribe({
      next: () => setTimeout(() => this.pendingToggles.delete(key), 300),
      error: () => {
        this.pendingToggles.delete(key);
        this.fetchTasks();
      }
    });
  }

  private shakeCard(childId: string, taskId: string): void {
    const el = document.querySelector(`[data-child-id="${childId}"][data-task-id="${taskId}"]`) as HTMLElement;
    if (!el) return;
    el.classList.remove('task-shake');
    void el.offsetWidth;
    el.classList.add('task-shake');
    setTimeout(() => el.classList.remove('task-shake'), 450);
  }

  // ─── Audio ───────────────────────────────────────────────────────────────────

  playAudio(feedback: string, d: AppData): void {
    if (!feedback) return;

    let type = 'tts';
    let value = feedback;
    let voice = '';
    const preset = d?.settings?.audio?.presets?.find(
      (p: AudioPreset) => p.id === feedback || p.value === feedback || p.name === feedback
    );

    if (preset) {
      type = preset.type || 'tts';
      value = preset.value || preset.name || feedback;
      voice = preset.voice || '';
    } else if (/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i.test(feedback) || feedback.startsWith('/sounds/')) {
      type = 'audio';
    }

    this.isAudioPlaying.set(true);
    this.cdr.markForCheck();

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(this.safetyTimer);
      this.isAudioPlaying.set(false);
      this.currentAudio = null;
      this.cdr.markForCheck();
    };
    this.safetyTimer = setTimeout(done, 8000);

    const url = type === 'audio'
      ? (value.startsWith('/') || value.startsWith('http') ? value : `/sounds/${encodeURIComponent(value)}`)
      : `/api/tts?text=${encodeURIComponent(value)}${voice ? `&voice=${encodeURIComponent(voice)}` : ''}`;

    this.currentAudio = new Audio(url);
    this.currentAudio.addEventListener('ended', done, { once: true });
    this.currentAudio.addEventListener('error', done, { once: true });
    this.currentAudio.play().catch(done);
  }

  stopAudio(): void {
    this.currentAudio?.pause();
    this.currentAudio = null;
    this.isAudioPlaying.set(false);
    clearTimeout(this.safetyTimer);
  }

  // ─── Network ─────────────────────────────────────────────────────────────────

  fetchTasks(): void {
    this.taskService.getTasks().subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading.set(false);
        this.cdr.markForCheck();
      },
    });
  }

  reconnect(): void {
    this.fetchTasks();
  }

  // ─── PIN Modal ───────────────────────────────────────────────────────────────

  openPinModal(): void {
    this.pinModalOpen.set(true);
  }

  onPinVerified(): void {
    this.pinModalOpen.set(false);
    this.router.navigate(['/parent']);
  }

  onPinClosed(): void {
    this.pinModalOpen.set(false);
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage.set('');
      this.cdr.markForCheck();
    }, 2500);
    this.cdr.markForCheck();
  }

  // ─── Pull-to-refresh ─────────────────────────────────────────────────────────

  @HostListener('touchstart', ['$event'])
  onTouchStart(e: TouchEvent): void {
    if (window.scrollY === 0) {
      this.pullStartY = e.touches[0].clientY;
      this.pulling = true;
    }
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(e: TouchEvent): void {
    if (!this.pulling) return;
    const dy = e.changedTouches[0].clientY - this.pullStartY;
    document.body.style.transform = '';
    if (dy >= 120 && window.scrollY === 0) location.reload();
    this.pulling = false;
  }
}
