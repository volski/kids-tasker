import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { TaskService } from '../../services/task.service';
import { AudioService } from '../../services/audio.service';
import { ParentShellComponent } from '../parent-shell/parent-shell.component';

@Component({
  selector: 'app-settings-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-tab.component.html',
  styleUrl: './settings-tab.component.css'
})
export class SettingsTabComponent implements OnInit {
  settings = signal<any>({});
  
  newTtsText = '';
  
  days = [
    { id: 0, label: 'ראשון' },
    { id: 1, label: 'שני' },
    { id: 2, label: 'שלישי' },
    { id: 3, label: 'רביעי' },
    { id: 4, label: 'חמישי' },
    { id: 5, label: 'שישי' },
    { id: 6, label: 'שבת' },
  ];

  constructor(
    private settingsService: SettingsService,
    private taskService: TaskService,
    private audioService: AudioService,
    private shell: ParentShellComponent
  ) {}

  ngOnInit() {
    this.loadSettings();
  }

  async loadSettings() {
    try {
      const s = await this.settingsService.getSettings().toPromise();
      this.settings.set(s || {});
    } catch (e: any) {
      this.shell.showToast('שגיאה בטעינת הגדרות: ' + e.message, 'error');
    }
  }

  get presets() {
    return this.settings()?.audio?.presets || [];
  }

  get resetTime() {
    return this.settings()?.resetTime || '06:00';
  }

  get isResetEnabled() {
    return !!this.settings()?.resetTime;
  }

  get bypassSchedule() {
    return this.settings()?.bypassSchedule || {};
  }

  get isBypassEnabled() {
    return Boolean(this.bypassSchedule.enabled);
  }

  getScheduleForDay(dayId: number) {
    const bs = this.bypassSchedule;
    if (!bs.schedule) return { enabled: false, startTime: '15:00', endTime: '21:00' };
    return bs.schedule[dayId] || { enabled: false, startTime: '15:00', endTime: '21:00' };
  }

  async saveResetSettings(time: string, enabled: boolean) {
    const resetTime = enabled ? (time || '06:00') : '';
    try {
      const s = await this.settingsService.updateSettings({ resetTime }).toPromise();
      this.settings.set(s?.settings || {});
      this.shell.showToast('הגדרות האיפוס נשמרו ✓');
    } catch (e: any) {
      this.shell.showToast('שגיאה בשמירת הגדרות: ' + e.message, 'error');
    }
  }

  async saveBypassSchedule(enabled: boolean, formData: any) {
    const schedule: any = {};
    this.days.forEach(d => {
      schedule[d.id] = {
        enabled: formData['day_enabled_' + d.id] || false,
        startTime: formData['day_start_' + d.id] || '15:00',
        endTime: formData['day_end_' + d.id] || '21:00'
      };
    });

    try {
      const s = await this.settingsService.updateSettings({ bypassSchedule: { enabled, schedule } }).toPromise();
      this.settings.set(s?.settings || {});
      this.shell.showToast('לוח הזמנים נשמר ✓');
    } catch (e: any) {
      this.shell.showToast('שגיאה בשמירת לוח הזמנים: ' + e.message, 'error');
    }
  }

  async saveAudioPresets(presets: any[]) {
    try {
      const res = await this.settingsService.updateSettings({ audio: { presets } }).toPromise();
      this.settings.set(res?.settings || {});
      this.shell.showToast('הגדרות צלילים נשמרו ✓');
      this.taskService.loadData().subscribe(); // refresh data in case manage tab is loaded
    } catch (e: any) {
      this.shell.showToast('שגיאה: ' + e.message, 'error');
    }
  }

  async uploadAudioFile(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const res = await fetch('/api/sounds/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, base64: e.target.result })
        });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        
        const newPreset = {
          id: 'audio_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          type: 'audio',
          name: data.file,
          value: data.file
        };
        
        const currentPresets = [...this.presets];
        currentPresets.push(newPreset);
        await this.saveAudioPresets(currentPresets);
        
        input.value = '';
        this.shell.showToast('קובץ השמע הועלה בהצלחה!');
      } catch (err: any) {
        this.shell.showToast('שגיאה בהעלאה: ' + err.message, 'error');
      }
    };
    reader.readAsDataURL(file);
  }

  async addTtsPreset() {
    const val = this.newTtsText.trim();
    if (!val) return;
    
    const newPreset = {
      id: 'tts_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      type: 'tts',
      name: val,
      value: val,
      voice: 'female'
    };
    
    const currentPresets = [...this.presets];
    currentPresets.push(newPreset);
    await this.saveAudioPresets(currentPresets);
    this.newTtsText = '';
  }

  async removePreset(index: number) {
    const preset = this.presets[index];
    if (!preset) return;
    
    const pVal = preset.value || preset.name || preset.id;
    const pName = preset.name || preset.value;
    const pId = preset.id;
    
    const usedBy: string[] = [];
    const kids = this.taskService.appData();
    kids.forEach(child => {
      child.tasks.forEach(t => {
        if (t.audioFeedback && (t.audioFeedback === pVal || t.audioFeedback === pName || (pId && t.audioFeedback === pId))) {
          usedBy.push(`"${t.title}" (${child.name})`);
        }
      });
    });
    
    if (usedBy.length > 0) {
      this.shell.showToast('לא ניתן למחוק! הצליל בשימוש במשימות: ' + usedBy.slice(0, 3).join(', '), 'error');
      return;
    }
    
    const currentPresets = [...this.presets];
    currentPresets.splice(index, 1);
    await this.saveAudioPresets(currentPresets);
  }

  async setPresetVoice(index: number, voice: string) {
    const currentPresets = [...this.presets];
    currentPresets[index].voice = voice;
    await this.saveAudioPresets(currentPresets);
  }

  playPreset(preset: any) {
    this.audioService.playAudio(preset.value || preset.name, preset.type, preset.voice);
  }

  stopAudio() {
    this.audioService.stopAudio();
  }

  isPresetUsed(preset: any) {
    const pVal = preset.value || preset.name || preset.id;
    const pName = preset.name || preset.value;
    const pId = preset.id;
    
    let isUsed = false;
    const kids = this.taskService.appData();
    kids.forEach(child => {
      child.tasks.forEach(t => {
        if (t.audioFeedback && (t.audioFeedback === pVal || t.audioFeedback === pName || (pId && t.audioFeedback === pId))) {
          isUsed = true;
        }
      });
    });
    return isUsed;
  }
}
