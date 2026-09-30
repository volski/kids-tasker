import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../services/task.service';
import { ParentShellComponent } from '../parent-shell/parent-shell.component';
import { Child, Task, Icon } from '../../models/task.model';

@Component({
  selector: 'app-manage-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-tab.component.html',
  styleUrl: './manage-tab.component.css'
})
export class ManageTabComponent implements OnInit {
  taskService = inject(TaskService);
  shell = inject(ParentShellComponent);

  children = this.taskService.appData;
  availableIcons = signal<Icon[]>([]);
  audioPresets = signal<any[]>([]);
  
  newChildName = '';
  
  dragState: { childId: string, taskId: string, sourceIdx: number, targetIdx: number | null } | null = null;
  
  // Temporary state for tasks being edited
  savingTasks = new Set<string>();

  ngOnInit() {
    this.taskService.loadData().subscribe();
    this.loadIcons();
    this.audioPresets.set(this.taskService.fullData()?.settings?.audio?.presets || []);
  }

  async loadIcons() {
    try {
      const res = await fetch('/api/icons');
      this.availableIcons.set(await res.json());
    } catch (err) {
      console.error('Failed to load icons', err);
    }
  }

  getAudioOptions() {
    return this.audioPresets();
  }

  async handleCreateChild() {
    const name = this.newChildName.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/children', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res.ok) throw new Error('Failed to create child');
      this.newChildName = '';
      this.shell.showToast(`הילד/ה "${name}" נוסף/ה ונשמר/ה בקובץ! ✓`);
      this.taskService.loadData().subscribe();
    } catch (err: any) {
      this.shell.showToast('שגיאה בהוספת ילד: ' + err.message, 'error');
    }
  }

  async handleUpdateChild(child: Child, silent = false) {
    const name = child.name.trim();
    if (!name) return;

    try {
      const res = await fetch(`/api/children/${child.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!res.ok) throw new Error('Failed to update child');
      
      if (!silent) this.shell.showToast(`השם עודכן ל-"${name}" ונשמר בהצלחה לקובץ! ✓`);
      this.taskService.loadData().subscribe();
    } catch (err: any) {
      if (!silent) this.shell.showToast('שגיאה בעדכון שם הילד: ' + err.message, 'error');
    }
  }

  async handleDeleteChild(child: Child) {
    if (!confirm(`האם למחוק את ${child.name} ואת כל המשימות המשויכות?\\nהפעולה תישמר ישירות לקובץ tasks.json.`)) return;

    try {
      const res = await fetch(`/api/children/${child.id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete child');
      this.shell.showToast(`${child.name} נמחק/ה בהצלחה מהקובץ! ✓`);
      this.taskService.loadData().subscribe();
    } catch (err: any) {
      this.shell.showToast('שגיאה במחיקת הילד: ' + err.message, 'error');
    }
  }

  // Task methods
  async handleAddTask(childId: string, event: Event, formValues: any) {
    event.preventDefault();
    if (!formValues.title) return;

    try {
      const res = await fetch(`/api/children/${childId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues)
      });
      if (!res.ok) throw new Error('Failed to add task');
      this.shell.showToast(`המשימה "${formValues.title}" נוספה ונשמרה בקובץ! ✓`);
      this.taskService.loadData().subscribe();
      
      // Reset form
      const form = event.target as HTMLFormElement;
      form.reset();
      
    } catch (err: any) {
      this.shell.showToast('שגיאה בהוספת משימה: ' + err.message, 'error');
    }
  }

  async handleUpdateTask(childId: string, task: Task, silent = false) {
    if (!task.title.trim()) return;

    this.savingTasks.add(task.id);
    try {
      const res = await fetch(`/api/children/${childId}/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: task.title,
          icon: task.icon,
          requiresApproval: task.requiresApproval,
          audioFeedback: task.audioFeedback,
          enabled: task.enabled
        })
      });
      if (!res.ok) throw new Error('Failed to update task');
      
      if (!silent) this.shell.showToast(`המשימה "${task.title}" עודכנה ונשמרה בהצלחה! ✓`);
      // Update data so it doesn't revert while polling
      this.taskService.loadData().subscribe();
    } catch (err: any) {
      if (!silent) this.shell.showToast('שגיאה בעדכון משימה: ' + err.message, 'error');
    } finally {
      this.savingTasks.delete(task.id);
    }
  }

  async handleDeleteTask(childId: string, task: Task) {
    if (!confirm(`האם למחוק את המשימה "${task.title}"?\\nהפעולה תישמר לקובץ.`)) return;

    try {
      const res = await fetch(`/api/children/${childId}/tasks/${task.id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete task');
      this.shell.showToast(`המשימה "${task.title}" נמחקה מהקובץ! ✓`);
      this.taskService.loadData().subscribe();
    } catch (err: any) {
      this.shell.showToast('שגיאה במחיקת משימה: ' + err.message, 'error');
    }
  }

  // Drag and drop
  onDragStart(event: DragEvent, childId: string, taskId: string, index: number) {
    this.dragState = { childId, taskId, sourceIdx: index, targetIdx: null };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskId);
    }
    setTimeout(() => {
      (event.target as HTMLElement).classList.add('opacity-40', 'scale-95');
    }, 0);
  }

  onDragOver(event: DragEvent, childId: string, index: number) {
    event.preventDefault();
    if (!this.dragState || this.dragState.childId !== childId) return;
    this.dragState.targetIdx = index;
  }

  onDragEnd(event: DragEvent) {
    (event.target as HTMLElement).classList.remove('opacity-40', 'scale-95');
    this.dragState = null;
  }

  async onDrop(event: DragEvent, child: Child) {
    event.preventDefault();
    if (!this.dragState || this.dragState.childId !== child.id || this.dragState.targetIdx === null) return;

    const srcIdx = this.dragState.sourceIdx;
    const tgtIdx = this.dragState.targetIdx;
    
    if (srcIdx === tgtIdx) return;

    // Optimistically reorder array locally
    const taskIds = child.tasks.map(t => t.id);
    const [removed] = taskIds.splice(srcIdx, 1);
    taskIds.splice(tgtIdx, 0, removed);
    
    // Also reorder the models array for UI continuity before API returns
    const tasksArray = [...child.tasks];
    const [removedTask] = tasksArray.splice(srcIdx, 1);
    tasksArray.splice(tgtIdx, 0, removedTask);
    child.tasks = tasksArray;

    try {
      const res = await fetch(`/api/children/${child.id}/tasks/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds })
      });
      if (!res.ok) throw new Error('Reorder failed');
      this.shell.showToast('סדר המשימות עודכן ✓');
    } catch (err: any) {
      this.shell.showToast('שגיאה בשמירת הסדר: ' + err.message, 'error');
      this.taskService.loadData().subscribe(); // Revert
    }
    
    this.dragState = null;
  }
}
