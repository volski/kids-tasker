import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PwaService {
  /** True when the browser has a deferred install prompt ready (Chrome, Edge, Android) */
  canInstall = signal(false);

  /** True when running on iOS Safari — no native prompt available */
  isIosSafari = signal(false);

  /** True when already running as a standalone installed PWA */
  isInstalled = signal(false);

  private deferredPrompt: any = null;

  constructor() {
    // Detect already installed (standalone mode)
    const mq = window.matchMedia('(display-mode: standalone)');
    this.isInstalled.set(mq.matches);
    mq.addEventListener('change', (e) => this.isInstalled.set(e.matches));

    // Detect iOS Safari (Apple doesn't support beforeinstallprompt)
    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|chrome/i.test(ua);
    this.isIosSafari.set(isIos && isSafari && !mq.matches);

    // Capture the install prompt on supporting browsers
    window.addEventListener('beforeinstallprompt', (e: any) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.canInstall.set(true);
    });

    // Clear prompt after install
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.isInstalled.set(true);
    });
  }

  async promptInstall(): Promise<void> {
    if (!this.deferredPrompt) return;
    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      this.canInstall.set(false);
    }
    this.deferredPrompt = null;
  }
}
