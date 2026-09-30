import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AppData } from '../models/task.model';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: Socket;
  private taskUpdated$ = new Subject<AppData>();

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
  }

  get onTaskUpdated(): Observable<AppData> {
    return this.taskUpdated$.asObservable();
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
    this.taskUpdated$.complete();
  }
}
