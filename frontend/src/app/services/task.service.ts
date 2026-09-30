import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AppData, Child, Task, TaskDelta } from '../models/task.model';

@Injectable({ providedIn: 'root' })
export class TaskService {
  public appData = signal<Child[]>([]);
  public fullData = signal<AppData | null>(null);

  constructor(private http: HttpClient) {}

  applyTaskDelta(delta: TaskDelta): void {
    // 1. Update appData (Child[])
    this.appData.update((children) => {
      return children.map((c) => {
        if (c.id !== delta.childId) return c;
        return {
          ...c,
          tasks: c.tasks.map((t) => {
            if (t.id !== delta.taskId) return t;
            return { ...t, ...delta.changes };
          }),
        };
      });
    });

    // 2. Update fullData (AppData)
    this.fullData.update((full) => {
      if (!full || !full.children) return full;
      return {
        ...full,
        children: full.children.map((c) => {
          if (c.id !== delta.childId) return c;
          return {
            ...c,
            tasks: c.tasks.map((t) => {
              if (t.id !== delta.taskId) return t;
              return { ...t, ...delta.changes };
            }),
          };
        }),
      };
    });
  }

  loadData(): Observable<AppData> {
    return this.http.get<AppData>('/api/tasks').pipe(
      tap((data) => {
        this.fullData.set(data);
        this.appData.set(data.children || []);
      })
    );
  }

  getTasks(): Observable<AppData> {
    return this.http.get<AppData>('/api/tasks');
  }

  toggleTask(childId: string, taskId: string, isParent = false): Observable<any> {
    return this.http.post('/api/tasks/toggle', { childId, taskId, isParent });
  }

  approveTask(childId: string, taskId: string): Observable<any> {
    return this.http.post('/api/tasks/approve', { childId, taskId });
  }

  resetDay(): Observable<any> {
    return this.http.post('/api/tasks/reset-day', {});
  }

  // Children
  createChild(name: string): Observable<any> {
    return this.http.post('/api/children', { name });
  }

  updateChild(id: string, name: string): Observable<any> {
    return this.http.put(`/api/children/${id}`, { name });
  }

  deleteChild(id: string): Observable<any> {
    return this.http.delete(`/api/children/${id}`);
  }

  // Tasks
  addTask(childId: string, task: Partial<Task>): Observable<any> {
    return this.http.post(`/api/children/${childId}/tasks`, task);
  }

  updateTask(childId: string, taskId: string, task: Partial<Task>): Observable<any> {
    return this.http.put(`/api/children/${childId}/tasks/${taskId}`, task);
  }

  deleteTask(childId: string, taskId: string): Observable<any> {
    return this.http.delete(`/api/children/${childId}/tasks/${taskId}`);
  }

  reorderTasks(childId: string, taskIds: string[]): Observable<any> {
    return this.http.post(`/api/children/${childId}/tasks/reorder`, { taskIds });
  }

  getHistory(date?: string): Observable<any> {
    const params = date ? `?date=${date}` : '';
    return this.http.get(`/api/history${params}`);
  }

  getIcons(): Observable<any[]> {
    return this.http.get<any[]>('/api/icons');
  }

  getSounds(): Observable<string[]> {
    return this.http.get<string[]>('/api/sounds');
  }
}
