import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

export interface AllowedDevice {
  deviceId: string;
  deviceName: string;
  householdId: string;
  status: string;
  pairedAt: string;
  lastSeen: string;
  ip?: string;
  userAgent?: string;
}

@Component({
  selector: 'app-devices-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      
      <!-- Top Banner & Manual Pairing Button -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-white flex items-center gap-2">
            <span>📱</span>
            <span>מכשירים ומסכים מורשים</span>
          </h2>
          <p class="text-sm text-slate-400 mt-1">ניהול והסרת גישה בזמן אמת לטלוויזיות ולטאבלטים של הילדים</p>
        </div>

        <button (click)="showPairModal.set(true)" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition shadow-lg flex items-center gap-2">
          <span>➕</span>
          <span>חבר מסך חדש בקוד</span>
        </button>
      </div>

      @if (isLoading()) {
        <div class="py-12 text-center text-slate-400 space-y-2">
          <div class="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p class="text-xs font-semibold">טוען רשימת מכשירים מורשים...</p>
        </div>
      } @else if (devices().length === 0) {
        <div class="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center space-y-4">
          <div class="text-5xl">📺</div>
          <h3 class="text-xl font-bold text-white">אין מכשירים מורשים כרגע</h3>
          <p class="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            חבר טלוויזיה או טאבלט על ידי סריקת קוד ה-QR שמופיע במסך הילדים, או לחץ על "חבר מסך חדש בקוד" והקלד את קוד ה-KIDS שמופיע במסך!
          </p>
        </div>
      } @else {
        <!-- Grid of Allowed Devices -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          @for (dev of devices(); track dev.deviceId) {
            <div class="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4 flex flex-col justify-between hover:border-slate-700 transition">
              <div class="space-y-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-indigo-950 border border-indigo-800/60 flex items-center justify-center text-2xl text-indigo-400 flex-shrink-0">
                      📺
                    </div>
                    <div>
                      <h3 class="text-lg font-bold text-white leading-tight">{{ dev.deviceName }}</h3>
                      <span class="text-[11px] text-slate-400 font-mono block mt-0.5">ID: {{ dev.deviceId.substring(0, 12) }}...</span>
                    </div>
                  </div>
                  <span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                    מורשה ✓
                  </span>
                </div>

                <div class="bg-slate-950 p-3 rounded-2xl border border-slate-800/80 text-xs space-y-1 text-slate-400">
                  <div class="flex justify-between">
                    <span>תאריך חיבור:</span>
                    <span class="text-slate-200 font-semibold">{{ formatDate(dev.pairedAt) }}</span>
                  </div>
                  @if (dev.ip) {
                    <div class="flex justify-between">
                      <span>כתובת IP:</span>
                      <span class="text-slate-300 font-mono">{{ dev.ip }}</span>
                    </div>
                  }
                </div>
              </div>

              <div class="pt-2 border-t border-slate-800/80">
                <button (click)="revoke(dev)" [disabled]="isRevoking() === dev.deviceId" class="w-full py-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-bold transition active:scale-95 flex items-center justify-center gap-1.5">
                  <span>🗑️</span>
                  <span>{{ isRevoking() === dev.deviceId ? 'מנתק מכשיר...' : 'הסר הרשאה ונתק מסך' }}</span>
                </button>
              </div>
            </div>
          }
        </div>
      }

      <!-- Manual Pair Modal -->
      @if (showPairModal()) {
        <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5 text-right">
            <div class="flex items-center justify-between">
              <h3 class="text-xl font-black text-white">חיבור מסך חדש בקוד</h3>
              <button (click)="showPairModal.set(false)" class="text-slate-400 hover:text-white text-xl font-bold">✕</button>
            </div>

            <p class="text-xs text-slate-400 leading-relaxed">
              הקלד את 6 התווים של קוד החיבור שמופיעים במסך הילדים (למשל: <code class="text-amber-300 font-mono bg-slate-950 px-2 py-0.5 rounded">KIDS-8492</code>):
            </p>

            @if (modalError()) {
              <div class="p-3 bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs font-bold rounded-xl">
                {{ modalError() }}
              </div>
            }

            <div class="space-y-3">
              <label class="block">
                <span class="text-xs font-bold text-slate-300 block mb-1">קוד חיבור:</span>
                <input type="text" [(ngModel)]="inputCode" placeholder="KIDS-1234" class="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-center text-lg font-bold uppercase focus:ring-2 focus:ring-indigo-500">
              </label>

              <label class="block">
                <span class="text-xs font-bold text-slate-300 block mb-1">שם המכשיר (למשל: טלוויזיה בסלון):</span>
                <input type="text" [(ngModel)]="inputName" placeholder="טלוויזיה בסלון" class="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-indigo-500">
              </label>
            </div>

            <div class="flex gap-3 pt-2">
              <button (click)="submitPairing()" [disabled]="isSubmittingModal()" class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition shadow">
                {{ isSubmittingModal() ? 'מבצע שיוך...' : 'שייך מסך עכשיו 📺' }}
              </button>
              <button (click)="showPairModal.set(false)" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-sm transition">
                ביטול
              </button>
            </div>
          </div>
        </div>
      }

    </div>
  `
})
export class DevicesTabComponent implements OnInit {
  private http = inject(HttpClient);

  public devices = signal<AllowedDevice[]>([]);
  public isLoading = signal<boolean>(true);
  public isRevoking = signal<string | null>(null);
  public showPairModal = signal<boolean>(false);
  public isSubmittingModal = signal<boolean>(false);
  public modalError = signal<string | null>(null);

  public inputCode = '';
  public inputName = 'מסך חדש';

  ngOnInit() {
    this.loadDevices();
  }

  public loadDevices() {
    this.isLoading.set(true);
    this.http.get<any>('/api/devices/allowed').subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res && res.devices) {
          this.devices.set(res.devices);
        }
      },
      error: () => this.isLoading.set(false)
    });
  }

  public submitPairing() {
    if (!this.inputCode.trim()) {
      this.modalError.set('יש להזין קוד חיבור');
      return;
    }
    this.isSubmittingModal.set(true);
    this.modalError.set(null);

    this.http.post<any>('/api/devices/pair', { code: this.inputCode, deviceName: this.inputName }).subscribe({
      next: (res) => {
        this.isSubmittingModal.set(false);
        if (res && res.success) {
          this.showPairModal.set(false);
          this.inputCode = '';
          this.loadDevices();
        } else {
          this.modalError.set(res.error || 'שגיאה בשיוך המסך');
        }
      },
      error: (err) => {
        this.isSubmittingModal.set(false);
        this.modalError.set(err.error?.error || 'שגיאה בשיוך המסך');
      }
    });
  }

  public revoke(dev: AllowedDevice) {
    if (!confirm(`האם אתה בטוח שברצונך לבטל את הרשאת הגישה ל-${dev.deviceName}? המסך ינותק באופן מיידי.`)) return;

    this.isRevoking.set(dev.deviceId);
    this.http.post<any>('/api/devices/revoke', { deviceId: dev.deviceId }).subscribe({
      next: (res) => {
        this.isRevoking.set(null);
        if (res && res.success) {
          this.loadDevices();
        }
      },
      error: () => this.isRevoking.set(null)
    });
  }

  public formatDate(iso: string): string {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }
}
