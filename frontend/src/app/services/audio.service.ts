import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AudioService {
  private currentAudio: HTMLAudioElement | null = null;
  private safetyTimer: any;

  playAudio(value: string, type: string = 'tts', voice: string = '') {
    this.stopAudio();
    if (!value) return;

    const url = type === 'audio'
      ? (value.startsWith('/') || value.startsWith('http') ? value : `/sounds/${encodeURIComponent(value)}`)
      : `/api/tts?text=${encodeURIComponent(value)}${voice ? `&voice=${encodeURIComponent(voice)}` : ''}`;

    this.currentAudio = new Audio(url);
    this.currentAudio.play().catch(e => console.warn('Audio play failed:', e));
    
    this.safetyTimer = setTimeout(() => {
      this.stopAudio();
    }, 15000);
  }

  stopAudio() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    clearTimeout(this.safetyTimer);
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
  }
}
