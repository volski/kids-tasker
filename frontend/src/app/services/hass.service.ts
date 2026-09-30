import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class HassService {
  constructor(private http: HttpClient) {}

  getConfig(): Observable<any> {
    return this.http.get('/api/hass/config');
  }

  saveConfig(config: any): Observable<any> {
    return this.http.post('/api/hass/config', config);
  }

  testConnection(payload: any): Observable<any> {
    return this.http.post('/api/hass/test', payload);
  }

  createEntities(): Observable<any> {
    return this.http.post('/api/hass/create-entities', {});
  }

  getStatus(): Observable<any> {
    return this.http.get('/api/hass/status');
  }

  setBypass(enabled: boolean): Observable<any> {
    return this.http.post('/api/hass/bypass', { enabled });
  }

  getCardYaml(): Observable<any> {
    return this.http.get('/api/hass/card-yaml');
  }

  addCard(): Observable<any> {
    return this.http.post('/api/hass/add-card', {});
  }
}
