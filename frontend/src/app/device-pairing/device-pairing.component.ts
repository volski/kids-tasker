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
      <div class="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
        
        <!-- Navigation Switcher: Parent Auth vs Child Display Pairing -->
        <div class="grid grid-cols-2 gap-2 p-1.5 bg-slate-950 rounded-2xl border border-slate-800/80">
          <button
            (click)="goToLogin()"
            class="py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm text-slate-400 hover:text-white hover:bg-slate-900 transition flex items-center justify-center gap-1.5"
          >
            <span>👑</span>
            <span>כניסת הורים / הרשמה</span>
          </button>

          <button
            class="py-2.5 px-3 bg-gradient-to-r from-amber-500 to-indigo-600 text-white font-bold text-xs sm:text-sm rounded-xl transition shadow-md flex items-center justify-center gap-1.5"
          >
            <span>📺</span>
            <span>חיבור מסך ילדים</span>
          </button>
        </div>

        <!-- Header / Logo -->
        <div class="flex items-center justify-center gap-3 pt-2">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-600 flex items-center justify-center text-3xl shadow-lg shadow-indigo-900/40">
            📺
          </div>
          <div class="text-right">
            <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">חיבור מסך ילדים חדש</h1>
            <p class="text-xs sm:text-sm text-slate-400 font-medium">סריקת הברקוד או הזנת הקוד לשיוך לוח המשימות למשפחה</p>
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

        <!-- Direct Parent Login Shortcut -->
        <div class="pt-4 border-t border-slate-800/80">
          <button (click)="goToLogin()" class="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-2xl text-xs sm:text-sm transition flex items-center justify-center gap-2 border border-slate-700">
            <span>👑</span>
            <span>רוצה להיכנס כהורה לחשבון / להירשם? לחץ כאן ➔</span>
          </button>
        </div>

      </div>
    </div>
  `
})
export class DevicePairingComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  public router = inject(Router);
  private socketService = inject(SocketService);

  public isLoading = signal<boolean>(true);
  public errorMsg = signal<string | null>(null);
  public pairingCode = signal<string>('');
  public qrDataUrl = signal<string>('');
  public sessionId = signal<string>('');
  
  private pollTimer: any = null;
  private socketPairedCallback: any = null;

  ngOnInit() {
    this.initSession();
  }

  ngOnDestroy() {
    this.cleanupListeners();
  }

  private cleanupListeners() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.socketPairedCallback && this.sessionId()) {
      this.socketService.off(`device_paired_${this.sessionId()}`, this.socketPairedCallback);
      this.socketPairedCallback = null;
    }
  }

  public goToLogin() {
    this.router.navigate(['/login']);
  }

  public async initSession() {
    this.cleanupListeners();
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.post<any>('/api/pairing/init', {}).subscribe({
      next: async (res) => {
        this.isLoading.set(false);
        if (res && res.code && res.sessionId) {
          this.pairingCode.set(res.code);
          this.sessionId.set(res.sessionId);

          // Generate QR Code URL pointing to /login?code=KIDS-XXXX
          const baseUrl = window.location.origin;
          const pairUrl = `${baseUrl}/#/login?code=${res.code}`;

          try {
            const dataUrl = await QRCode.toDataURL(pairUrl, { width: 300, margin: 2 });
            this.qrDataUrl.set(dataUrl);
          } catch (e) {
            console.error('Failed to generate QR Code', e);
          }

          // Socket event listener for instant pairing
          this.socketPairedCallback = (data: any) => {
            if (data && (data.deviceToken || data.success)) {
              this.handlePairingSuccess(data);
            }
          };
          this.socketService.on(`device_paired_${res.sessionId}`, this.socketPairedCallback);

          // Start polling for pairing completion status
          this.startPollingStatus(res.sessionId);
        } else {
          this.errorMsg.set('שגיאה ביצירת קוד חיבור');
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMsg.set(err.error?.error || 'שגיאת תקשורת מול השרת');
      }
    });
  }

  private handlePairingSuccess(data: { deviceToken?: string; householdId?: string }) {
    this.cleanupListeners();

    // Save device token locally & set active household ID
    if (data.deviceToken) {
      localStorage.setItem('kids_tasker_device_token', data.deviceToken);
    }
    if (data.householdId) {
      localStorage.setItem('kids_tasker_household_id', data.householdId);
    }

    // Connect Socket.io with new device credentials
    this.socketService.connect();

    // Redirect immediately to Kids Board
    this.router.navigate(['/']);
  }

  private startPollingStatus(sessId: string) {
    if (this.pollTimer) clearInterval(this.pollTimer);

    this.pollTimer = setInterval(() => {
      this.http.get<any>(`/api/pairing/status/${sessId}`).subscribe({
        next: (res) => {
          if (res && (res.status === 'paired' || res.paired) && res.deviceToken) {
            this.handlePairingSuccess(res);
          }
        }
      });
    }, 2000);
  }
}
