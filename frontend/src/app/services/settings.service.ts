import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  constructor(private http: HttpClient) {}

  getSettings(): Observable<any> {
    return this.http.get('/api/settings');
  }

  updateSettings(settings: any): Observable<any> {
    return this.http.post('/api/settings', settings);
  }
}
