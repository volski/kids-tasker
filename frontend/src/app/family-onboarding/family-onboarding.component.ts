import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HouseholdService, HouseholdInfo } from '../services/household.service';

@Component({
  selector: 'app-family-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6 text-right dir-rtl">
        <div class="text-center space-y-2">
          <div class="w-16 h-16 bg-gradient-to-tr from-amber-500 to-orange-500 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-lg shadow-orange-500/20">
            👨‍👩‍👧‍👦
          </div>
          <h2 class="text-2xl font-black text-white">ברוכים הבאים ל-Kids Tasker!</h2>
          <p class="text-sm text-slate-400">בחר אם ליצור קבוצה משפחתית חדשה או להצטרף למשפחה קיימת</p>
        </div>

        <!-- Mode Selector Tabs -->
        <div class="grid grid-cols-2 gap-2 p-1.5 bg-slate-950 rounded-2xl border border-slate-800">
          <button
            (click)="mode = 'create'"
            [class.bg-gradient-to-r]="mode === 'create'"
            [class.from-indigo-600]="mode === 'create'"
            [class.to-purple-600]="mode === 'create'"
            [class.text-white]="mode === 'create'"
            [class.text-slate-400]="mode !== 'create'"
            class="py-2.5 rounded-xl font-bold text-sm transition shadow-sm"
          >
            🏠 צור משפחה חדשה
          </button>

          <button
            (click)="mode = 'join'"
            [class.bg-gradient-to-r]="mode === 'join'"
            [class.from-purple-600]="mode === 'join'"
            [class.to-pink-600]="mode === 'join'"
            [class.text-white]="mode === 'join'"
            [class.text-slate-400]="mode !== 'join'"
            class="py-2.5 rounded-xl font-bold text-sm transition shadow-sm"
          >
            🔗 הצטרף למשפחה קיימת
          </button>
        </div>

        <!-- Mode 1: Create Household -->
        <div *ngIf="mode === 'create'" class="space-y-4 pt-2">
          <div>
            <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">שם המשפחה</label>
            <input
              type="text"
              [(ngModel)]="familyName"
              placeholder="לדוגמה: משפחת ישראלי"
              class="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
            />
          </div>

          <button
            (click)="handleCreate()"
            [disabled]="loading || !familyName.trim()"
            class="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white font-bold rounded-xl text-base shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2"
          >
            <span *ngIf="!loading">צור משפחה חדשה 🏠</span>
            <span *ngIf="loading" class="animate-spin">⏳</span>
          </button>
        </div>

        <!-- Mode 2: Join Household -->
        <div *ngIf="mode === 'join'" class="space-y-4 pt-2">
          <div>
            <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">קוד הצטרפות למשפחה (FAM-XXXX)</label>
            <input
              type="text"
              [(ngModel)]="joinCode"
              placeholder="FAM-1234"
              class="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-center tracking-widest text-lg placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500 uppercase font-bold"
            />
            <p class="text-xs text-slate-400 mt-1">בקש את הקוד 6 ספרות מההורה שפתח את החשבון המשפחתי</p>
          </div>

          <button
            (click)="handleJoin()"
            [disabled]="loading || !joinCode.trim()"
            class="w-full py-3.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold rounded-xl text-base shadow-lg shadow-purple-600/30 transition flex items-center justify-center gap-2"
          >
            <span *ngIf="!loading">הצטרף למשפחה 🔗</span>
            <span *ngIf="loading" class="animate-spin">⏳</span>
          </button>
        </div>

        <!-- Error Alert -->
        <div *ngIf="errorMessage" class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs font-bold text-center">
          {{ errorMessage }}
        </div>

        <!-- Skip Action -->
        <div class="text-center pt-2">
          <button (click)="handleSkip()" class="text-xs text-slate-400 hover:text-slate-200 transition underline">
            המשך עם הגדרות ברירת מחדל ➔
          </button>
        </div>
      </div>
    </div>
  `
})
export class FamilyOnboardingComponent {
  @Output() completed = new EventEmitter<HouseholdInfo>();

  private householdService = inject(HouseholdService);

  mode: 'create' | 'join' = 'create';
  familyName: string = 'משפחת ישראלי';
  joinCode: string = '';
  loading: boolean = false;
  errorMessage: string = '';

  handleCreate() {
    if (!this.familyName.trim()) return;
    this.loading = true;
    this.errorMessage = '';
    this.householdService.createHousehold(this.familyName).subscribe({
      next: (res) => {
        this.loading = false;
        if (res && res.household) {
          this.completed.emit(res.household);
        }
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err.error?.error || 'שגיאה ביצירת משפחה חדשה';
      }
    });
  }

  handleJoin() {
    if (!this.joinCode.trim()) return;
    this.loading = true;
    this.errorMessage = '';
    this.householdService.joinHousehold(this.joinCode).subscribe({
      next: (res) => {
        this.loading = false;
        if (res && res.household) {
          this.completed.emit(res.household);
        }
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err.error?.error || 'קוד הצטרפות לא תקין';
      }
    });
  }

  handleSkip() {
    this.householdService.getMyHousehold().subscribe({
      next: (res) => {
        if (res && res.household) {
          this.completed.emit(res.household);
        }
      }
    });
  }
}
