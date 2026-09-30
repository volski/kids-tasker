import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import * as QRCode from 'qrcode';
import { SocketService } from '../services/socket.service';

@Component({
  selector: 'app-device-pairing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
      <div class="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
        
        <!-- Header / Logo -->
        <div class="flex items-center justify-center gap-3">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-600 flex items-center justify-center text-3xl shadow-lg shadow-indigo-900/40">
            📺
          </div>
          <div class="text-right">
            <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">חיבור מסך חדש</h1>
            <p class="text-xs sm:text-sm text-slate-400 font-medium">סריקת הברקוד לשיוך לוח המשימות למשפחה</p>
          </div>
        </div>

        @if (isLoading()) {
          <div class="py-12 space-y-4">
            <div class="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p class="text-sm font-semibold text-slate-400">מייצר קוד חיבור מאובטח...</p>
          </div>
        } @else if (errorMsg()) {
          <div class="py-8 space-y-4">
            <p class="text-rose-400 font-bold text-sm bg-rose-950/60 border border-rose-800/60 p-4 rounded-2xl">{{ errorMsg() }}</p>
            <button (click)="initSession()" class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm shadow transition">
              נסה שוב 🔄
            </button>
          </div>
        } @else {
          <!-- QR Code Render Area -->
          <div class="bg-white p-5 rounded-3xl inline-block shadow-inner mx-auto border-4 border-indigo-500/30">
            @if (qrDataUrl()) {
              <img [src]="qrDataUrl()" alt="QR Code" class="w-56 h-56 sm:w-64 sm:h-64 rounded-xl mx-auto">
            }
          </div>

          <!-- Pairing Code Display -->
          <div class="space-y-2">
            <span class="text-xs font-bold text-slate-400 uppercase tracking-widest block">או הקלד קוד חיבור ידני:</span>
            <div class="inline-block px-6 py-3 bg-slate-950 border border-indigo-500/40 rounded-2xl text-3xl sm:text-4xl font-mono font-black text-indigo-400 tracking-wider shadow-inner">
              {{ pairingCode() }}
            </div>
          </div>

          <!-- Instructions -->
          <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 text-xs sm:text-sm text-slate-300 space-y-1.5 text-right leading-relaxed">
            <p class="font-bold text-white flex items-center gap-1.5">
              <span>📱</span>
              <span>הוראות חיבור להורים:</span>
            </p>
            <ol class="list-decimal list-inside space-y-1 text-slate-400 pr-2">
              <li>פתח את מצלמת הטלפון וסרוק את הברקוד שעל המסך</li>
              <li>או היכנס ללוח הורים ➔ <strong>מכשירים מורשים</strong> ➔ <strong>חבר מסך חדש</strong></li>
              <li>הכנס את קוד החיבור המוצג מעלה ואישור החיבור יתבצע באופן מיידי!</li>
            </ol>
          </div>

          <!-- Live Status Indicator -->
          <div class="pt-2 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400">
            <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
            <span>ממתין לסריקת הורה...</span>
          </div>
        }

      </div>
    </div>
  `
})
export class DevicePairingComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private router = inject(Router);
  private socketService = inject(SocketService);

  public isLoading = signal<boolean>(true);
  public errorMsg = signal<string | null>(null);
  public pairingCode = signal<string>('');
  public qrDataUrl = signal<string>('');
  public sessionId = signal<string>('');
  
  private pollTimer: any = null;

  ngOnInit() {
    this.initSession();
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  public async initSession() {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.post<any>('/api/devices/init-pairing', {}).subscribe({
      next: async (res) => {
        if (res && res.success) {
          this.pairingCode.set(res.code);
          this.sessionId.set(res.sessionId);
          
          const pairingUrl = `${window.location.origin}/#/pair?code=${res.code}`;
          try {
            const dataUrl = await QRCode.toDataURL(pairingUrl, { width: 300, margin: 1 });
            this.qrDataUrl.set(dataUrl);
          } catch (e) {
            console.error('Failed to generate QR code:', e);
          }

          this.isLoading.set(false);
          this.startListeningForPairing(res.sessionId);
        } else {
          this.errorMsg.set(res.error || 'שגיאה ביצירת קוד חיבור');
          this.isLoading.set(false);
        }
      },
      error: (err) => {
        this.errorMsg.set('שגיאת תקשורת בחיבור לשרת');
        this.isLoading.set(false);
      }
    });
  }

  private startListeningForPairing(sessionId: string) {
    // 1. WebSocket listener for instant pairing
    this.socketService.on(`device_paired_${sessionId}`, (data: any) => {
      if (data && data.deviceToken) {
        this.onDevicePaired(data.deviceToken);
      }
    });

    // 2. Fallback HTTP Polling every 3 seconds
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this.http.get<any>(`/api/devices/pairing-status?sessionId=${sessionId}`).subscribe({
        next: (status) => {
          if (status && status.paired && status.deviceToken) {
            this.onDevicePaired(status.deviceToken);
          }
        },
        error: () => {}
      });
    }, 3000);
  }

  private onDevicePaired(deviceToken: string) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    localStorage.setItem('kids_tasker_device_token', deviceToken);
    this.router.navigate(['/']);
  }
}
