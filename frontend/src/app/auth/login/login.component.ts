import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FirebaseAuthService } from '../../core/services/firebase-auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
      <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        
        <!-- Header -->
        <div class="text-center space-y-2">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-3xl mx-auto shadow-lg shadow-indigo-900/40">
            👑
          </div>
          <h1 class="text-2xl font-black text-white">כניסת הורים להרשמה / התחברות</h1>
          <p class="text-xs text-slate-400">ניהול לוח משימות, הגדרות, מכשירים מורשים ובית חכם</p>
        </div>

        @if (pairingCode()) {
          <!-- Active Pairing Banner if scanned QR Code -->
          <div class="bg-indigo-950/80 border border-indigo-700/60 p-4 rounded-2xl space-y-2 text-right">
            <div class="flex items-center gap-2 text-indigo-300 font-bold text-sm">
              <span>📲</span>
              <span>שיוך מסך חדש למשפחה</span>
            </div>
            <p class="text-xs text-slate-300">אתה עומד לחבר את המסך שקודו <code class="bg-indigo-900 px-2 py-0.5 rounded text-amber-300 font-mono">{{ pairingCode() }}</code> למשתמש שלך.</p>
          </div>
        }

        @if (errorMsg()) {
          <div class="bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs font-bold p-3.5 rounded-xl text-center">
            {{ errorMsg() }}
          </div>
        }

        @if (authService.currentUser; as user) {
          <!-- Logged in State -->
          <div class="space-y-4 text-center">
            <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
              <span class="text-xs text-slate-400 block font-semibold">מחובר כ-</span>
              <p class="font-bold text-sm text-emerald-400">{{ user.email || user.displayName || 'משתמש רשום' }}</p>
            </div>

            @if (pairingCode()) {
              <div class="space-y-3 pt-2">
                <label class="block text-right">
                  <span class="text-xs font-bold text-slate-300 block mb-1">שם המכשיר לבחירה (למשל: טלוויזיה בסלון):</span>
                  <input type="text" [(ngModel)]="deviceName" class="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                </label>
                <button (click)="submitDevicePairing()" [disabled]="isSubmitting()" class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2">
                  <span>{{ isSubmitting() ? 'מבצע שיוך...' : 'אישור שיוך מכשיר זה 📺' }}</span>
                </button>
              </div>
            } @else {
              <button (click)="goToDashboard()" class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2">
                <span>כניסה ללוח הורים ➔</span>
              </button>
            }

            <button (click)="authService.logout()" class="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition">
              התנתק מהחשבון
            </button>
          </div>
        } @else {
          <!-- Login Buttons & Form -->
          <div class="space-y-4">
            <button (click)="handleGoogleLogin()" class="w-full py-3 px-4 bg-white hover:bg-slate-100 text-slate-900 font-bold rounded-xl text-sm shadow-md transition flex items-center justify-center gap-3">
              <span class="text-lg">🔑</span>
              <span>התחבר מהר עם Google</span>
            </button>

            <div class="relative flex items-center py-1">
              <div class="flex-grow border-t border-slate-800"></div>
              <span class="flex-shrink-0 mx-4 text-slate-500 text-xs font-bold uppercase tracking-widest">או במייל וסיסמה</span>
              <div class="flex-grow border-t border-slate-800"></div>
            </div>

            <form (submit)="handleEmailAuth(); $event.preventDefault()" class="space-y-3 text-right">
              <div>
                <label class="text-xs font-bold text-slate-300 block mb-1">כתובת אימייל</label>
                <input type="email" [(ngModel)]="email" name="email" required class="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500" placeholder="your@email.com">
              </div>

              <div>
                <label class="text-xs font-bold text-slate-300 block mb-1">סיסמה</label>
                <input type="password" [(ngModel)]="password" name="password" required class="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500" placeholder="••••••••">
              </div>

              <div class="flex gap-2 pt-2">
                <button type="submit" (click)="isSignUp = false" class="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition shadow-md">
                  התחבר ➔
                </button>
                <button type="submit" (click)="isSignUp = true" class="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-sm transition">
                  הרשם חדש 📝
                </button>
              </div>
            </form>
          </div>
        }

      </div>
    </div>
  `
})
export class LoginComponent implements OnInit {
  public authService = inject(FirebaseAuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);

  public email = '';
  public password = '';
  public isSignUp = false;
  public deviceName = 'טלוויזיה / מסך חדש';
  public pairingCode = signal<string | null>(null);
  public errorMsg = signal<string | null>(null);
  public isSubmitting = signal<boolean>(false);

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['code']) {
        this.pairingCode.set(params['code']);
      }
    });
  }

  public async handleGoogleLogin() {
    this.errorMsg.set(null);
    try {
      await this.authService.loginWithGoogle();
      if (!this.pairingCode()) {
        this.goToDashboard();
      }
    } catch (err: any) {
      this.errorMsg.set(err.message || 'שגיאה בהתחברות Google');
    }
  }

  public async handleEmailAuth() {
    this.errorMsg.set(null);
    if (!this.email || !this.password) {
      this.errorMsg.set('יש להזין אימייל וסיסמה');
      return;
    }

    try {
      if (this.isSignUp) {
        await this.authService.signUpWithEmail(this.email, this.password);
      } else {
        await this.authService.loginWithEmail(this.email, this.password);
      }

      if (!this.pairingCode()) {
        this.goToDashboard();
      }
    } catch (err: any) {
      this.errorMsg.set(err.message || 'שגיאה בהתחברות');
    }
  }

  public submitDevicePairing() {
    const code = this.pairingCode();
    if (!code) return;
    this.isSubmitting.set(true);
    this.errorMsg.set(null);

    this.http.post<any>('/api/devices/pair', { code, deviceName: this.deviceName }).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        if (res && res.success) {
          alert('המסך שויך בהצלחה! 🎉');
          this.goToDashboard();
        } else {
          this.errorMsg.set(res.error || 'שגיאה בשיוך המסך');
        }
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.errorMsg.set(err.error?.error || 'שגיאה בשיוך המכשיר');
      }
    });
  }

  public goToDashboard() {
    this.router.navigate(['/parent/status']);
  }
}
