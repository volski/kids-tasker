import {
  Component, Output, EventEmitter, signal, OnInit, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PinService } from '../../services/pin.service';

type PinMode = 'verify' | 'setup_enter' | 'setup_confirm';

const MIN_PIN = 4;
const MAX_PIN = 6;

@Component({
  selector: 'app-pin-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pin-modal.component.html',
  styleUrl: './pin-modal.component.css',
})
export class PinModalComponent implements OnInit {
  @Output() verified = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  mode = signal<PinMode>('verify');
  currentPin = '';
  firstPin = '';
  errorMsg = signal('');
  isShaking = signal(false);

  title = signal('כניסה להורים');
  subtitle = signal('הזן את קוד ה-PIN (4-6 ספרות)');
  cancelLabel = signal('ביטול');

  readonly digits = [1,2,3,4,5,6,7,8,9];

  constructor(private pinService: PinService) {}

  ngOnInit(): void {
    this.pinService.getPinStatus().subscribe({
      next: ({ hasPin }) => this.resetModal(hasPin ? 'verify' : 'setup_enter'),
      error: () => this.resetModal('setup_enter'),
    });
  }

  get dotsCount(): number {
    return (this.mode() === 'setup_confirm' && this.firstPin.length >= MIN_PIN)
      ? this.firstPin.length : MAX_PIN;
  }

  get dots(): boolean[] {
    return Array.from({ length: this.dotsCount }, (_, i) => i < this.currentPin.length);
  }

  resetModal(mode: PinMode, preserveFirst = false): void {
    this.mode.set(mode);
    this.currentPin = '';
    if (!preserveFirst) this.firstPin = '';
    this.errorMsg.set('');
    if (mode === 'verify') {
      this.title.set('כניסה להורים');
      this.subtitle.set('הזן את קוד ה-PIN');
      this.cancelLabel.set('ביטול');
    } else if (mode === 'setup_enter') {
      this.title.set('🔐 הגדרת קוד גישה');
      this.subtitle.set('בחר קוד PIN חדש (4-6 ספרות)');
      this.cancelLabel.set('ביטול');
    } else {
      this.title.set('✅ אמת את הקוד');
      this.subtitle.set(`הזן שוב את הקוד (${this.firstPin.length} ספרות)`);
      this.cancelLabel.set('התחל מחדש');
    }
  }

  onDigit(d: number | string): void {
    const limit = (this.mode() === 'setup_confirm' && this.firstPin.length >= MIN_PIN)
      ? this.firstPin.length : MAX_PIN;
    if (this.currentPin.length >= limit) return;
    this.currentPin += String(d);
    this.errorMsg.set('');
    if (this.currentPin.length === limit &&
        (this.mode() === 'verify' || this.mode() === 'setup_confirm')) {
      setTimeout(() => this.submit(), 120);
    }
  }

  onDelete(): void {
    this.currentPin = this.currentPin.slice(0, -1);
    this.errorMsg.set('');
  }

  onCancel(): void {
    if (this.mode() === 'setup_confirm') {
      this.resetModal('setup_enter');
    } else {
      this.closed.emit();
    }
  }

  async submit(): Promise<void> {
    const m = this.mode();
    if (m === 'verify') {
      if (this.currentPin.length < MIN_PIN) { this.showError('קוד ה-PIN חייב להכיל לפחות 4 ספרות'); return; }
      this.pinService.verifyPin(this.currentPin).subscribe({
        next: (res) => {
          if (res.success) {
            sessionStorage.setItem('kids_tasker_parent_unlocked', '1');
            this.verified.emit();
          } else {
            this.showError(res.message || 'קוד שגוי, נסה שוב');
            this.currentPin = '';
          }
        },
        error: (err) => {
          this.showError(err.error?.error || err.error?.message || 'קוד שגוי, נסה שוב');
          this.currentPin = '';
        }
      });
    } else if (m === 'setup_enter') {
      if (this.currentPin.length < MIN_PIN) { this.showError('יש להזין לפחות 4 ספרות'); return; }
      this.firstPin = this.currentPin;
      this.resetModal('setup_confirm', true);
    } else {
      if (this.currentPin !== this.firstPin) {
        this.showError('הקודים אינם תואמים – התחל מחדש');
        setTimeout(() => this.resetModal('setup_enter'), 1400);
        return;
      }
      this.pinService.setPin(this.currentPin).subscribe({
        next: (res) => {
          if (res.success) {
            sessionStorage.setItem('kids_tasker_parent_unlocked', '1');
            this.verified.emit();
          } else {
            this.showError(res.error || 'שגיאה בשמירת הקוד');
            this.currentPin = '';
          }
        },
        error: (err) => {
          this.showError(err.error?.error || err.error?.message || 'שגיאה בשמירת הקוד');
          this.currentPin = '';
        }
      });
    }
  }

  showError(msg: string): void {
    this.errorMsg.set(msg);
    this.isShaking.set(true);
    setTimeout(() => this.isShaking.set(false), 400);
  }

  onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); this.onDigit(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); this.onDelete(); }
    else if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); this.closed.emit(); }
  }
}
