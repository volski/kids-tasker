import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div class="bg-slate-900 border border-slate-700/50 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
        <div class="p-6 text-center">
          <div class="w-16 h-16 mx-auto bg-rose-500/20 text-rose-400 rounded-full flex items-center justify-center mb-4">
            <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">{{ title }}</h3>
          <p class="text-slate-400 text-sm whitespace-pre-line">{{ message }}</p>
        </div>
        
        <div class="flex border-t border-slate-800">
          <button (click)="onCancel.emit()" class="flex-1 py-4 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors">
            ביטול
          </button>
          <div class="w-px bg-slate-800"></div>
          <button (click)="onConfirm.emit()" class="flex-1 py-4 text-sm font-bold text-rose-500 hover:bg-rose-500/10 transition-colors">
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ConfirmModalComponent {
  @Input() title = 'האם אתה בטוח?';
  @Input() message = '';
  @Input() confirmText = 'אישור';
  @Output() onConfirm = new EventEmitter<void>();
  @Output() onCancel = new EventEmitter<void>();
}
