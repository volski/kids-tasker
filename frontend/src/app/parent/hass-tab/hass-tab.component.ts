import { Component, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { HassService } from '../../services/hass.service';
import { SocketService } from '../../services/socket.service';
import { ParentShellComponent } from '../parent-shell/parent-shell.component';

@Component({
  selector: 'app-hass-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './hass-tab.component.html',
  styleUrl: './hass-tab.component.css'
})
export class HassTabComponent implements OnInit, OnDestroy {
  config = signal({
    enabled: false,
    url: '',
    tokenMasked: '',
    token: '', // raw token for saving
    tvEntityId: '',
    autoBlockTv: false
  });
  
  status = signal<any>({});
  yamlCode = signal('');
  
  createdEntities = signal<any[]>([]);
  showEntitiesFeedback = signal(false);
  
  testResult = signal<{ ok: boolean, message: string, warning?: string, entityState?: any } | null>(null);
  
  isSaving = signal(false);
  isTesting = signal(false);
  isCreating = signal(false);
  isAddingCard = signal(false);
  
  private socketSub?: Subscription;

  constructor(
    private hassService: HassService,
    private socketService: SocketService,
    private shell: ParentShellComponent
  ) {}

  ngOnInit() {
    this.loadConfig();
    this.loadStatus();
    this.loadYaml();
    
    // Listen for socket updates to refresh status
    this.socketSub = this.socketService.onTaskUpdated.subscribe(() => {
      this.loadStatus();
    });
  }

  ngOnDestroy() {
    this.socketSub?.unsubscribe();
  }

  async loadConfig() {
    try {
      const res = await fetch('/api/hass/config');
      const data = await res.json();
      this.config.set({
        enabled: Boolean(data.enabled),
        url: data.url || '',
        tokenMasked: data.hasToken ? data.tokenMasked : '',
        token: '',
        tvEntityId: data.tvEntityId || '',
        autoBlockTv: Boolean(data.autoBlockTv)
      });
    } catch (err) {
      console.error('Failed to load Home Assistant config:', err);
    }
  }

  async loadStatus() {
    try {
      const st = await this.hassService.getStatus().toPromise();
      this.status.set(st || {});
    } catch (e) {}
  }

  async loadYaml() {
    try {
      const res = await fetch('/api/hass/card-yaml');
      const data = await res.json();
      if (data.success && data.yaml) {
        this.yamlCode.set(data.yaml);
      }
    } catch (e) {}
  }

  async saveConfig(e: Event) {
    e.preventDefault();
    this.isSaving.set(true);
    const cfg = this.config();
    
    try {
      const payload = {
        enabled: cfg.enabled,
        url: cfg.url,
        token: cfg.token || undefined, // only send if they typed something
        tvEntityId: cfg.tvEntityId,
        autoBlockTv: cfg.autoBlockTv
      };
      
      const res = await fetch('/api/hass/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      this.shell.showToast('הגדרות Home Assistant נשמרו וישויות סונכרנו! ✓');
      this.loadConfig(); // reload to get masked token
      
      if (cfg.enabled) {
        this.createEntities();
      }
    } catch (err: any) {
      this.shell.showToast('שגיאה בשמירת הגדרות: ' + err.message, 'error');
    } finally {
      this.isSaving.set(false);
    }
  }

  async testConnection() {
    this.isTesting.set(true);
    const cfg = this.config();
    
    try {
      const res = await fetch('/api/hass/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cfg.url, token: cfg.token || cfg.tokenMasked, tvEntityId: cfg.tvEntityId })
      });
      const data = await res.json();
      this.testResult.set(data);
      
      if (data.ok) {
        this.shell.showToast('בדיקת החיבור ל-Home Assistant עברה בהצלחה! ✓');
      } else {
        this.shell.showToast('בדיקת החיבור נכשלה', 'error');
      }
    } catch (err: any) {
      this.testResult.set({ ok: false, message: 'שגיאת רשת בבדיקת חיבור: ' + err.message });
    } finally {
      this.isTesting.set(false);
    }
  }

  async createEntities() {
    this.isCreating.set(true);
    try {
      const res = await fetch('/api/hass/create-entities', { method: 'POST' });
      const data = await res.json();
      
      this.showEntitiesFeedback.set(true);
      if (data.success && data.entities) {
        this.createdEntities.set(data.entities);
        this.shell.showToast(`${data.entities.length} ישויות נוצרו ב-Home Assistant! ✓`);
      } else {
        this.shell.showToast(data.error || 'נכשל ביצירת ישויות.', 'error');
      }
    } catch (err: any) {
      this.shell.showToast('שגיאת רשת ביצירת ישויות: ' + err.message, 'error');
    } finally {
      this.isCreating.set(false);
    }
  }

  async toggleBypass() {
    try {
      const currentState = this.status().parent_bypass;
      const nextState = !currentState;
      
      await this.hassService.setBypass(nextState).toPromise();
      
      this.shell.showToast(nextState ? 'מעקף הורים הופעל! הטלוויזיה מותרת 🔓' : 'מעקף הורים בוטל! 🔒');
      this.loadStatus();
    } catch (err: any) {
      this.shell.showToast('שגיאה בעדכון מעקף: ' + err.message, 'error');
    }
  }

  async addLovelaceCard() {
    this.isAddingCard.set(true);
    try {
      const res = await fetch('/api/hass/add-card', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.shell.showToast('הכרטיס נוסף בהצלחה ל-Home Assistant! 🎉');
      } else {
        this.shell.showToast('נכשל בהוספת הכרטיס ל-Home Assistant', 'error');
      }
    } catch (err: any) {
      this.shell.showToast('שגיאת רשת: ' + err.message, 'error');
    } finally {
      this.isAddingCard.set(false);
    }
  }

  copyYaml(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      this.shell.showToast('קוד ה-YAML הועתק ללוח! 📋');
    });
  }
}
