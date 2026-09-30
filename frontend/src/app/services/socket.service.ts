import { Injectable, OnDestroy, Injector } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AppData, TaskDelta } from '../models/task.model';
import { FirebaseAuthService } from '../core/services/firebase-auth.service';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: Socket;
  private taskUpdated$ = new Subject<AppData>();
  private taskDelta$ = new Subject<TaskDelta>();

  constructor(private injector: Injector) {
    this.socket = io({ transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected:', this.socket.id);
      this.joinHousehold();
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

    this.socket.on('device_revoked', () => {
      const devToken = localStorage.getItem('kids_tasker_device_token');
      if (devToken) {
        localStorage.removeItem('kids_tasker_device_token');
        window.location.href = '/#/pairing';
      }
    });
  }

  public async joinHousehold(tokenOverride?: string): Promise<void> {
    const deviceToken = localStorage.getItem('kids_tasker_device_token');
    let idToken = tokenOverride;
    if (!idToken) {
      try {
        const authService = this.injector.get(FirebaseAuthService);
        idToken = (await authService.getIdToken()) || undefined;
      } catch {}
    }
    this.socket.emit('join_household', { token: idToken, deviceToken });
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
