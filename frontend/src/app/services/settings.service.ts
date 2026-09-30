import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Settings } from '../models/task.model';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private http: HttpClient) {}

  getSettings(): Observable<Settings> {
    return this.http.get<Settings>('/api/settings');
  }

  saveSettings(settings: Partial<Settings>): Observable<any> {
    return this.http.post('/api/settings', settings);
  }

  uploadSound(filename: string, base64: string): Observable<any> {
    return this.http.post('/api/sounds/upload', { filename, base64 });
  }
}
