import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class HassService {
  constructor(private http: HttpClient) {}

  getStatus(): Observable<any> {
    return this.http.get('/api/hass/status');
  }

  getConfig(): Observable<any> {
    return this.http.get('/api/hass/config');
  }

  saveConfig(config: any): Observable<any> {
    return this.http.post('/api/hass/config', config);
  }

  testConnection(config: any): Observable<any> {
    return this.http.post('/api/hass/test', config);
  }

  createEntities(): Observable<any> {
    return this.http.post('/api/hass/create-entities', {});
  }

  addCard(): Observable<any> {
    return this.http.post('/api/hass/add-card', {});
  }

  getCardYaml(): Observable<string> {
    return this.http.get('/api/hass/card-yaml', { responseType: 'text' });
  }

  setBypass(enabled: boolean): Observable<any> {
    return this.http.post('/api/hass/bypass', { state: enabled ? 'on' : 'off' });
  }
}
