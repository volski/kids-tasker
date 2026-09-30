import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PinService {
  isVerified = signal(false);

  constructor(private http: HttpClient) {}

  getPinStatus(): Observable<{ hasPin: boolean }> {
    return this.http.get<{ hasPin: boolean }>('/api/parent/pin-status');
  }

  verifyPin(pin: string): Observable<{ success: boolean; message?: string }> {
    return this.http.post<{ success: boolean; message?: string }>('/api/parent/verify-pin', { pin });
  }

  setPin(pin: string, currentPin?: string): Observable<any> {
    return this.http.post('/api/parent/set-pin', { pin, currentPin });
  }

  setVerified(value: boolean): void {
    this.isVerified.set(value);
  }
}
