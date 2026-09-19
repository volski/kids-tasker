// Kids Tablet Controller (Modular Firebase Edition)
import { 
  getStoredFamilyId, 
  setStoredFamilyId, 
  getStoredRole 
} from './firebase-config.js';
import { 
  subscribeToFamily, 
  toggleTask, 
  getTodayDateString 
} from './db.js';

// DOM Elements
const boardElem = document.getElementById('board');
const loadingElem = document.getElementById('loading-spinner');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusBadge = document.getElementById('status-badge');
const tvStatusBadge = document.getElementById('tv-status-badge');
const currentDateElem = document.getElementById('current-date');
const familyTitleElem = document.getElementById('family-title');

let currentData = null;
let currentFamilyId = getStoredFamilyId();
const pendingToggles = new Set();

// Color themes for children cards
const childColors = [
  { bg: 'from-blue-600 to-indigo-700', border: 'border-blue-400/40', accent: 'text-blue-400' },
  { bg: 'from-amber-500 to-orange-600', border: 'border-amber-400/40', accent: 'text-amber-400' },
  { bg: 'from-pink-500 to-rose-600', border: 'border-pink-400/40', accent: 'text-pink-400' },
  { bg: 'from-purple-600 to-violet-700', border: 'border-purple-400/40', accent: 'text-purple-400' },
  { bg: 'from-emerald-500 to-teal-600', border: 'border-emerald-400/40', accent: 'text-emerald-400' },
  { bg: 'from-cyan-500 to-blue-600', border: 'border-cyan-400/40', accent: 'text-cyan-400' }
];

// Display Hebrew Date
function renderHebrewDate() {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const today = new Date().toLocaleDateString('he-IL', options);
  if (currentDateElem) {
    currentDateElem.innerText = today;
  }
}

// Format ISO timestamp to HH:MM
function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function updateConnectionStatus(isConnected) {
  if (isConnected) {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50';
    statusText.innerText = 'מחובר ל-Firebase';
    statusBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-950/60 border border-emerald-800/60 text-emerald-300';
  } else {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse';
    statusText.innerText = 'מנותק - מתחבר...';
    statusBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-950/60 border border-rose-800/60 text-rose-300';
  }
}

function updateTvBadge(data) {
  if (!tvStatusBadge) return;
  if (!data.homeAssistant || !data.homeAssistant.enabled) {
    tvStatusBadge.classList.add('hidden');
    tvStatusBadge.classList.remove('flex');
    return;
  }

  let total = 0;
  let completed = 0;
  (data.children || []).forEach(c => {
    total += (c.tasks || []).length;
    completed += (c.tasks || []).filter(t => t.completed).length;
  });
  const allDone = total > 0 && completed === total;
  const isBypass = Boolean(data.homeAssistant && data.homeAssistant.parentBypass);

  tvStatusBadge.classList.remove('hidden');
  tvStatusBadge.classList.add('flex');

  if (allDone) {
    tvStatusBadge.className = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 shadow-sm animate-pulse';
    tvStatusBadge.innerHTML = '<span>📺</span><span>טלוויזיה מותרת! 🎉</span>';
  } else if (isBypass) {
    tvStatusBadge.className = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-purple-950/80 border border-purple-700/80 text-purple-300 shadow-sm animate-pulse';
    tvStatusBadge.innerHTML = '<span>🔓</span><span>טלוויזיה מותרת (מעקף הורים)</span>';
  } else {
    tvStatusBadge.className = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-rose-950/80 border border-rose-800/80 text-rose-300 shadow-sm';
    tvStatusBadge.innerHTML = `<span>🔒</span><span>טלוויזיה חסומה (${total - completed} נותרו)</span>`;
  }
}

export function showToast(msg) {
  const el = document.getElementById('tablet-toast');
  if (!el) return;
  el.innerText = msg;
  el.classList.remove('opacity-0');
  el.classList.add('opacity-100');
  setTimeout(() => {
    el.classList.remove('opacity-100');
    el.classList.add('opacity-0');
  }, 2500);
}

export async function onTaskClick(childId, taskId) {
  if (currentData) {
    const child = (currentData.children || []).find(c => c.id === childId);
    if (child) {
      const task = (child.tasks || []).find(t => t.id === taskId);
      if (task && task.completed) {
        showToast('המשימה כבר בוצעה! רק הורים יכולים לבטל משימה שבוצעה 🔒');
        return;
      }
    }
  }

  const toggleKey = `${childId}_${taskId}`;
  if (pendingToggles.has(toggleKey)) return;
  pendingToggles.add(toggleKey);

  // Optimistic UI update
  if (currentData) {
    const child = (currentData.children || []).find(c => c.id === childId);
    if (child) {
      const task = (child.tasks || []).find(t => t.id === taskId);
      if (task) {
        task.completed = true;
        task.completedAt = new Date().toISOString();
        renderBoard(currentData);
      }
    }
  }

  try {
    await toggleTask(currentFamilyId, childId, taskId, false);
  } catch (err) {
    console.error('Error toggling task:', err);
    showToast(err.message || 'שגיאה בעדכון משימה');
  } finally {
    setTimeout(() => {
      pendingToggles.delete(toggleKey);
    }, 300);
  }
}

// Expose onTaskClick to window for inline onclick attributes
window.onTaskClick = onTaskClick;

export function renderBoard(data) {
  currentData = data;
  loadingElem.classList.add('hidden');
  boardElem.classList.remove('hidden');
  updateTvBadge(data);

  if (familyTitleElem && data.name) {
    familyTitleElem.innerText = data.name;
  }

  if (!data || !data.children || data.children.length === 0) {
    boardElem.innerHTML = `
      <div class="col-span-full text-center py-16 bg-slate-900/60 rounded-3xl border border-slate-800">
        <p class="text-slate-400 text-xl font-bold mb-3">עדיין לא הוגדרו ילדים בלוח</p>
        <a href="/parent" class="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition">
          עבור ללוח ניהול הורים להוספת ילדים
        </a>
      </div>`;
    return;
  }

  boardElem.innerHTML = data.children.map((child, index) => {
    const theme = childColors[index % childColors.length];
    const tasks = child.tasks || [];
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const isAllDone = total > 0 && completed === total;

    return `
      <section class="bg-slate-900/90 rounded-3xl border border-slate-800 p-5 sm:p-7 shadow-2xl flex flex-col gap-6 relative overflow-hidden transition-all duration-200">
        <!-- Header for child -->
        <div class="flex items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr ${theme.bg} flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-black/40 border ${theme.border}">
              ${child.name.charAt(0)}
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">${child.name}</h2>
                ${isAllDone ? '<span class="text-xl animate-bounce" title="כל הכבוד!">🎉</span>' : ''}
              </div>
              <p class="text-sm font-medium text-slate-400 mt-0.5">
                ${completed} מתוך ${total} משימות בוצעו
              </p>
            </div>
          </div>

          <!-- Progress Badge -->
          <div class="text-left flex flex-col items-end">
            <span class="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${isAllDone ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}">
              ${percentage}%
            </span>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="w-full bg-slate-800/80 h-3.5 rounded-full overflow-hidden p-0.5 border border-slate-700/50">
          <div class="h-full rounded-full transition-all duration-500 ease-out ${isAllDone ? 'bg-gradient-to-l from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/50' : 'bg-gradient-to-l from-indigo-500 to-indigo-400'}"
               style="width: ${percentage}%"></div>
        </div>

        <!-- Tasks List with Icons -->
        <div class="flex flex-col gap-3.5" role="list">
          ${tasks.length === 0 ? '<p class="text-slate-500 text-center py-6">אין משימות מוגדרות לילד זה</p>' : tasks.map(task => {
            const isCompleted = task.completed;
            const cardBg = isCompleted ? 'bg-emerald-600' : 'bg-rose-700';
            const cardHover = isCompleted ? 'hover:bg-emerald-600' : 'hover:bg-rose-600';
            const statusLabel = isCompleted ? 'בוצע ✔ 🔒' : 'טרם בוצע ❌';
            const badgeStyle = isCompleted ? 'bg-emerald-800/70 border-emerald-400/40 text-emerald-100' : 'bg-rose-900/70 border-rose-400/40 text-rose-100';
            const completedTimeStr = isCompleted && task.completedAt ? formatTime(task.completedAt) : '';
            const taskIcon = task.icon || 'star';
            const interactiveClasses = isCompleted ? 'cursor-default opacity-95' : 'cursor-pointer active:scale-[0.98]';

            return `
              <button 
                type="button"
                onclick="window.onTaskClick('${child.id}', '${task.id}')"
                class="task-card w-full text-right p-4 sm:p-5 rounded-2xl ${cardBg} ${cardHover} text-white shadow-lg ${interactiveClasses} flex items-center justify-between gap-4 border border-white/10 focus:outline-none focus:ring-4 focus:ring-indigo-400/50 transition-all select-none"
                aria-pressed="${isCompleted}"
                data-child-id="${child.id}"
                data-task-id="${task.id}"
              >
                <div class="flex items-center gap-3.5 min-w-0">
                  <div class="w-12 h-12 rounded-2xl bg-black/25 p-1.5 flex items-center justify-center flex-shrink-0 border border-white/10 shadow-sm">
                    <img 
                      src="/icons/${taskIcon}.svg" 
                      alt="${task.title}" 
                      class="w-full h-full object-contain filter drop-shadow"
                      onerror="this.onerror=null; this.src='/icons/star.svg';"
                    >
                  </div>
                  <div class="flex flex-col min-w-0">
                    <span class="text-lg sm:text-xl font-bold tracking-tight truncate leading-tight ${isCompleted ? 'line-through decoration-white/60 text-white/90' : 'text-white'}">
                      ${task.title}
                    </span>
                    ${completedTimeStr ? `<span class="text-xs text-emerald-200/90 mt-0.5">הושלם בשעה ${completedTimeStr}</span>` : ''}
                  </div>
                </div>

                <span class="flex-shrink-0 px-3.5 py-1.5 text-sm sm:text-base font-bold rounded-xl border shadow-inner ${badgeStyle}">
                  ${statusLabel}
                </span>
              </button>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }).join('');
}

window.pairTabletCode = function() {
  const code = document.getElementById('tablet-pair-code')?.value?.trim();
  if (code) {
    setStoredFamilyId(code);
    window.location.href = `/?family=${encodeURIComponent(code)}`;
  }
};

// Initialize Realtime Listener
function init() {
  renderHebrewDate();
  updateConnectionStatus(false);

  // Check URL query parameters for instant pairing via QR code or direct link
  const urlParams = new URLSearchParams(window.location.search);
  const urlFamily = urlParams.get('family');
  if (urlFamily) {
    setStoredFamilyId(urlFamily);
    currentFamilyId = urlFamily;
  }

  if (!currentFamilyId) {
    loadingElem.classList.add('hidden');
    boardElem.classList.remove('hidden');
    boardElem.innerHTML = `
      <div class="col-span-full text-center py-16 bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md mx-auto space-y-4 shadow-2xl">
        <div class="text-5xl">📱</div>
        <h2 class="text-2xl font-bold text-white">חיבור טאבלט</h2>
        <p class="text-slate-400 text-sm">הטאבלט עדיין לא מחובר למשפחה. הזן את קוד המשפחה או סרוק את קוד ה-QR מלוח ההורים.</p>
        <div class="flex gap-2 pt-2">
          <input id="tablet-pair-code" placeholder="קוד משפחה (fam_...)" class="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white">
          <button onclick="window.pairTabletCode()" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition">חבר</button>
        </div>
        <div class="pt-4 border-t border-slate-800">
          <a href="/parent.html" class="inline-block text-xs text-indigo-400 hover:underline font-semibold">פתח לוח ניהול הורים ליצירת משפחה &larr;</a>
        </div>
      </div>
    `;
    return;
  }

  // Subscribe to Firestore changes
  subscribeToFamily(currentFamilyId, data => {
    updateConnectionStatus(true);
    renderBoard(data);
  }, err => {
    updateConnectionStatus(false);
    console.error('[Tablet] Subscription error:', err);
  });
}

// Run init immediately if DOM is already ready (top-level await support)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
