import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import * as QRCode from 'qrcode';
import { HouseholdService, HouseholdInfo, FamilyMember } from '../../services/household.service';
import { FamilyOnboardingComponent } from '../../family-onboarding/family-onboarding.component';
import { FirebaseAuthService } from '../../core/services/firebase-auth.service';
import { ParentShellComponent } from '../parent-shell/parent-shell.component';

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
  imports: [CommonModule, FormsModule, FamilyOnboardingComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Family Group Banner & Management Card -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-800/40 rounded-3xl p-5 sm:p-6 shadow-xl space-y-6">
        
        <!-- Header & Info -->
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center text-2xl shadow-inner">
              🏠
            </div>
            <div>
              @if (isEditingName()) {
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    [(ngModel)]="editNameValue"
                    class="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-bold text-base focus:ring-2 focus:ring-indigo-500"
                  />
                  <button (click)="saveFamilyName()" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition">שמור</button>
                  <button (click)="isEditingName.set(false)" class="px-2 py-1.5 text-slate-400 hover:text-white text-xs font-semibold">ביטול</button>
                </div>
              } @else {
                <h2 class="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
                  <span>{{ household()?.name || 'המשפחה שלי' }}</span>
                  @if (isOwner()) {
                    <button (click)="startEditingName()" class="text-slate-400 hover:text-indigo-300 text-sm p-1" title="ערוך שם משפחה">✏️</button>
                  }
                </h2>
              }
              <p class="text-xs text-slate-400 mt-0.5">קבוצה משפחתית משותפת להורים ולמסכים מורשים</p>
            </div>
          </div>

          <!-- Join Code & Share Actions -->
          <div class="flex flex-wrap items-center gap-3">
            <div class="bg-slate-950 px-4 py-2 rounded-2xl border border-indigo-500/40 flex items-center gap-2 shadow-inner">
              <span class="text-xs text-slate-400 font-semibold">קוד הצטרפות:</span>
              <span class="text-base font-extrabold text-amber-400 font-mono tracking-wider">{{ household()?.joinCode || 'FAM-....' }}</span>
              <button (click)="copyJoinCode()" class="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded-lg text-slate-300 transition" title="העתק קוד">
                {{ copySuccess() ? '✓ הועתק!' : '📋 העתק' }}
              </button>
            </div>

            <button (click)="openQrModal()" class="px-3.5 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white font-bold rounded-xl text-xs transition border border-indigo-500/40 flex items-center gap-1.5 shadow">
              <span>📷</span>
              <span>הצג QR להורה</span>
            </button>

            <button (click)="showFamilyModal.set(true)" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs transition border border-slate-700 flex items-center gap-1.5">
              <span>⚙️</span>
              <span>צור / הצטרף למשפחה</span>
            </button>

            @if (isOwner()) {
              <button (click)="deleteHousehold()" class="px-3.5 py-2 bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow">
                <span>🗑️</span>
                <span>מחק משפחה</span>
              </button>
            }
          </div>
        </div>

        <!-- Pending Members Approval Section (for Managers) -->
        @if (isOwner() && household()?.pendingMemberProfiles?.length) {
          <div class="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-4 space-y-3 shadow-md">
            <div class="flex items-center justify-between">
              <h3 class="text-xs font-black text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>⏳</span>
                <span>בקשות הצטרפות שממתינות לאישורך ({{ household()?.pendingMemberProfiles?.length }})</span>
              </h3>
            </div>

            <div class="space-y-2">
              @for (p of household()?.pendingMemberProfiles; track p.uid) {
                <div class="bg-slate-900 border border-amber-500/20 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-sm flex-shrink-0">
                      {{ (p.name || p.email).charAt(0).toUpperCase() }}
                    </div>
                    <div class="min-w-0">
                      <div class="text-xs font-bold text-white truncate dir-ltr text-right">{{ p.name || p.email }}</div>
                      <div class="text-[10px] text-amber-400/80">ממתין לאישור מנהל</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    <button (click)="approveMember(p)" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition shadow flex items-center gap-1">
                      <span>✓</span>
                      <span>אשר</span>
                    </button>
                    <button (click)="rejectMember(p)" class="px-2.5 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold text-xs rounded-lg transition flex items-center gap-1">
                      <span>✕</span>
                      <span>דחה</span>
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Members Profiles List -->
        <div class="pt-4 border-t border-slate-800/80 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-extrabold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <span>👨‍👩‍👧‍👦</span>
              <span>חברי המשפחה ({{ household()?.memberProfiles?.length || 0 }})</span>
            </h3>

            @if (!isOwner() && household()?.memberProfiles?.length) {
              <button (click)="leaveHousehold()" class="text-xs text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1">
                <span>🚪</span>
                <span>עזוב קבוצה משפחתית</span>
              </button>
            }
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            @for (m of household()?.memberProfiles; track m.uid) {
              <div class="bg-slate-950 border border-slate-800/90 rounded-2xl p-3.5 flex items-center justify-between gap-3 shadow-sm">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-10 h-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-lg flex-shrink-0">
                    👤
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-bold text-white truncate dir-ltr text-right">{{ m.name || m.email }}</span>
                      @if (m.role === 'owner') {
                        <span class="px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-extrabold rounded-md flex-shrink-0">
                          בעלים 👑
                        </span>
                      } @else {
                        <span class="px-2 py-0.5 bg-slate-800 text-slate-400 text-[10px] font-semibold rounded-md flex-shrink-0">
                          חבר/ה
                        </span>
                      }
                    </div>
                    <span class="text-[11px] text-slate-500 truncate block dir-ltr text-right">{{ m.email }}</span>
                  </div>
                </div>

                <!-- Owner Actions per member -->
                @if (isOwner() && m.uid !== currentUid()) {
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <button (click)="transferOwner(m)" class="p-1.5 hover:bg-slate-800 text-amber-400 rounded-lg text-xs" title="העבר בעלות למשתמש זה">
                      👑
                    </button>
                    <button (click)="removeMember(m)" class="p-1.5 hover:bg-rose-950/60 text-rose-400 rounded-lg text-xs" title="הסר משתמש ממהמשפחה">
                      🗑️
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        </div>

      </div>

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

      <!-- QR Share Modal -->
      @if (showQrModal()) {
        <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-5 text-center">
            <div class="flex items-center justify-between">
              <h3 class="text-xl font-black text-white">הצטרפות הורה למשפחה</h3>
              <button (click)="showQrModal.set(false)" class="text-slate-400 hover:text-white text-xl font-bold">✕</button>
            </div>

            <p class="text-xs text-slate-400">סרוק את הברקוד בטלפון של ההורה השני להצטרפות מיידית למשפחה:</p>

            <div class="bg-white p-4 rounded-2xl inline-block shadow-inner mx-auto border-4 border-indigo-500/30">
              @if (qrDataUrl()) {
                <img [src]="qrDataUrl()" alt="Family Join QR" class="w-48 h-48 rounded-lg mx-auto">
              }
            </div>

            <div class="space-y-1">
              <span class="text-xs font-bold text-slate-400 block">קוד הצטרפות:</span>
              <div class="text-2xl font-black text-amber-400 font-mono tracking-widest bg-slate-950 py-2 rounded-xl border border-slate-800">
                {{ household()?.joinCode }}
              </div>
            </div>

            <button (click)="showQrModal.set(false)" class="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-sm transition">
              סגור
            </button>
          </div>
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

      <!-- Family Onboarding Modal -->
      @if (showFamilyModal()) {
        <app-family-onboarding (completed)="onFamilyCompleted($event)"></app-family-onboarding>
      }

    </div>
  `
})
export class DevicesTabComponent implements OnInit {
  private http = inject(HttpClient);
  private householdService = inject(HouseholdService);
  private authService = inject(FirebaseAuthService);
  private router = inject(Router);
  private shell = inject(ParentShellComponent, { optional: true });

  public household = signal<HouseholdInfo | null>(null);
  public devices = signal<AllowedDevice[]>([]);
  public isLoading = signal<boolean>(true);
  public isRevoking = signal<string | null>(null);
  public showPairModal = signal<boolean>(false);
  public showFamilyModal = signal<boolean>(false);
  public showQrModal = signal<boolean>(false);
  public isSubmittingModal = signal<boolean>(false);
  public modalError = signal<string | null>(null);

  public isEditingName = signal<boolean>(false);
  public editNameValue = '';
  public copySuccess = signal<boolean>(false);
  public qrDataUrl = signal<string | null>(null);

  public inputCode = '';
  public inputName = 'מסך חדש';

  public currentUid = computed(() => this.authService.currentUser?.uid);
  public isOwner = computed(() => {
    const h = this.household();
    const uid = this.currentUid();
    if (!h || !uid) return true;
    return h.ownerUid === uid;
  });

  ngOnInit() {
    this.loadHousehold();
    this.loadDevices();
  }

  public loadHousehold() {
    this.householdService.getMyHousehold().subscribe({
      next: (res) => {
        if (res && res.household) {
          this.household.set(res.household);
        }
      }
    });
  }

  public onFamilyCompleted(info: HouseholdInfo) {
    this.household.set(info);
    this.showFamilyModal.set(false);
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

  public copyJoinCode() {
    const code = this.household()?.joinCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2000);
    });
  }

  public async openQrModal() {
    const code = this.household()?.joinCode;
    if (!code) return;
    try {
      const url = await QRCode.toDataURL(code, { width: 300, margin: 2 });
      this.qrDataUrl.set(url);
      this.showQrModal.set(true);
    } catch (err) {
      console.error('Failed to render QR Code', err);
    }
  }

  public startEditingName() {
    this.editNameValue = this.household()?.name || '';
    this.isEditingName.set(true);
  }

  public saveFamilyName() {
    if (!this.editNameValue.trim()) return;
    this.householdService.renameHousehold(this.editNameValue).subscribe({
      next: (res) => {
        if (res && res.household) {
          this.household.set(res.household);
        }
        this.isEditingName.set(false);
      }
    });
  }

  public approveMember(m: FamilyMember) {
    this.householdService.approveMember(m.uid).subscribe({
      next: (res) => {
        if (res && res.household) {
          this.household.set(res.household);
        }
      }
    });
  }

  public rejectMember(m: FamilyMember) {
    if (!confirm(`האם לדחות את בקשת ההצטרפות של ${m.name || m.email}?`)) return;
    this.householdService.rejectMember(m.uid).subscribe({
      next: (res) => {
        if (res && res.household) {
          this.household.set(res.household);
        }
      }
    });
  }

  public removeMember(m: FamilyMember) {
    if (!confirm(`האם אתה בטוח שברצונך להסיר את ${m.name || m.email} מהמשפחה?`)) return;
    this.householdService.removeMember(m.uid).subscribe({
      next: (res) => {
        if (res && res.household) {
          this.household.set(res.household);
        }
      }
    });
  }

  public transferOwner(m: FamilyMember) {
    if (!confirm(`האם להעביר את הניהול הראשי של המשפחה ל-${m.name || m.email}?`)) return;
    this.householdService.transferOwnership(m.uid).subscribe({
      next: (res) => {
        if (res && res.household) {
          this.household.set(res.household);
        }
      }
    });
  }

  public leaveHousehold() {
    if (!confirm('האם אתה בטוח שברצונך לעזוב את הקבוצה המשפחתית?')) return;
    this.householdService.leaveHousehold().subscribe({
      next: (res) => {
        if (res && res.household) {
          this.household.set(res.household);
          this.showFamilyModal.set(true);
        }
      }
    });
  }

  public deleteHousehold() {
    if (!confirm('האם אתה בטוח שברצונך למחוק את המשפחה? כל חברי המשפחה ינותקו והנתונים יימחקו. פעולה זו אינה הפיכה!')) return;

    this.householdService.deleteHousehold().subscribe({
      next: async (res) => {
        if (res && res.success) {
          if (this.shell) this.shell.showToast('המשפחה נמחקה בהצלחה ✓', 'success');
          await this.authService.logout();
          this.router.navigate(['/']);
        }
      },
      error: (err) => {
        if (this.shell) this.shell.showToast('שגיאה במחיקת המשפחה: ' + (err.error?.error || err.message), 'error');
      }
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
