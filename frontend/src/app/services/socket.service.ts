import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AppData, TaskDelta } from '../models/task.model';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: Socket;
  private taskUpdated$ = new Subject<AppData>();
  private taskDelta$ = new Subject<TaskDelta>();

  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected:', this.socket.id);
    });

    this.socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
    });

    this.socket.on('task_updated', (data: AppData) => {
      this.taskUpdated$.next(data);
    });

    this.socket.on('task_delta', (delta: TaskDelta) => {
      this.taskDelta$.next(delta);
    });
  }

  get onTaskUpdated(): Observable<AppData> {
    return this.taskUpdated$.asObservable();
  }

  get onTaskDelta(): Observable<TaskDelta> {
    return this.taskDelta$.asObservable();
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  connect(): void {
    if (!this.socket.connected) {
      this.socket.connect();
    }
  }

  on(event: string, callback: (data: any) => void): void {
    this.socket.on(event, callback);
  }

  off(event: string, callback?: (data: any) => void): void {
    this.socket.off(event, callback);
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
    this.taskUpdated$.complete();
  }
}
