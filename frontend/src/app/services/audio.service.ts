import { Injectable, signal } from '@angular/core';
import { AudioPreset } from '../models/task.model';

@Injectable({ providedIn: 'root' })
export class AudioService {
  isPlaying = signal(false);
  playingText = signal('');

  private currentAudio: HTMLAudioElement | null = null;
  private finished = false;

  playTaskAudio(
    feedback: string,
    preset: AudioPreset | null,
    onDone: () => void
  ): void {
    if (!feedback && !preset) { onDone(); return; }

    let type = 'tts';
    let value = feedback;
    let voice = '';

    if (preset) {
      type = preset.type || 'tts';
      value = preset.value || preset.name || feedback;
      voice = preset.voice || '';
    } else if (/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i.test(feedback) || feedback.startsWith('/sounds/')) {
      type = 'audio';
    }

    this.finished = false;
    const doneCallback = () => {
      if (this.finished) return;
      this.finished = true;
      this.isPlaying.set(false);
      this.playingText.set('');
      onDone();
    };

    if (type === 'audio') {
      const soundUrl = feedback.startsWith('/sounds/') ? feedback : `/sounds/${feedback}`;
      this.currentAudio = new Audio(soundUrl);
      this.isPlaying.set(true);
      this.playingText.set('🔊');
      this.currentAudio.addEventListener('ended', doneCallback, { once: true });
      this.currentAudio.addEventListener('error', doneCallback, { once: true });
      this.currentAudio.play().catch(doneCallback);
    } else {
      // TTS via server
      this.isPlaying.set(true);
      this.playingText.set(value);
      const url = `/api/tts?text=${encodeURIComponent(value)}${voice ? `&voice=${encodeURIComponent(voice)}` : ''}`;
      this.currentAudio = new Audio(url);
      this.currentAudio.addEventListener('ended', doneCallback, { once: true });
      this.currentAudio.addEventListener('error', doneCallback, { once: true });
      this.currentAudio.play().catch(doneCallback);
    }
  }

  stopAll(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.isPlaying.set(false);
    this.playingText.set('');
  }
}
