import { 
  getStoredFamilyId, 
  setStoredFamilyId, 
  loginWithGoogle, 
  logoutUser, 
  subscribeToAuth 
} from './firebase-config.js?v=2.3.0';
import { 
  subscribeToFamily, 
  toggleTask, 
  getTodayDateString,
  subscribeToUserProfile,
  requestJoinFamily,
  cancelJoinRequest,
  claimFamilyIfUnowned,
  registerTabletRequest
} from './db.js?v=2.3.0';

// DOM Elements
const authLanding = document.getElementById('auth-landing');
const viewPendingApproval = document.getElementById('view-pending-approval');
const viewTabletPending = document.getElementById('view-tablet-pending');
const viewTabletDisconnected = document.getElementById('view-tablet-disconnected');
const viewNoFamily = document.getElementById('view-no-family');
const loadingElem = document.getElementById('loading-spinner');
const boardElem = document.getElementById('board');
const pendingFamilyCodeDisplay = document.getElementById('pending-family-code-display');
const tabletFamilyDisplay = document.getElementById('tablet-family-display');
const tabletDeviceIdDisplay = document.getElementById('tablet-device-id-display');

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusBadge = document.getElementById('status-badge');
const tvStatusBadge = document.getElementById('tv-status-badge');
const currentDateElem = document.getElementById('current-date');
const familyTitleElem = document.getElementById('family-title');

const userProfileBar = document.getElementById('user-profile-bar');
const userAvatar = document.getElementById('user-avatar');
const userDisplayName = document.getElementById('user-display-name');

let currentData = null;
let currentFamilyId = getStoredFamilyId();
let currentUser = null;
let familyUnsubscribe = null;
let userProfileUnsubscribe = null;
const pendingToggles = new Set();
let wasApprovedTablet = false;

// Device Identification for Tablet Mode
export function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem('kids_tasker_device_id');
  if (!deviceId) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let rand = '';
    for (let i = 0; i < 8; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    deviceId = `tab_${rand}`;
    localStorage.setItem('kids_tasker_device_id', deviceId);
  }
  return deviceId;
}

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
  if (!statusDot || !statusText || !statusBadge) return;
  if (isConnected) {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50';
    statusText.innerText = 'מחובר';
    statusBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-950/60 border border-emerald-800/60 text-emerald-300';
  } else {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse';
    statusText.innerText = 'מתחבר...';
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

export function showToast(msg, isError = false) {
  const el = document.getElementById('tablet-toast');
  if (!el) return;
  el.innerText = msg;
  el.className = `fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 border text-white font-bold rounded-2xl shadow-2xl transition-all duration-300 z-50 text-center text-sm ${
    isError ? 'bg-rose-600 border-rose-500' : 'bg-slate-800 border-slate-700'
  }`;
  el.classList.remove('opacity-0', 'pointer-events-none');
  el.classList.add('opacity-100');
  setTimeout(() => {
    el.classList.remove('opacity-100');
    el.classList.add('opacity-0', 'pointer-events-none');
  }, 2800);
}

function showView(viewName) {
  if (authLanding) authLanding.classList.add('hidden');
  if (viewPendingApproval) viewPendingApproval.classList.add('hidden');
  if (viewTabletPending) viewTabletPending.classList.add('hidden');
  if (viewTabletDisconnected) viewTabletDisconnected.classList.add('hidden');
  if (viewNoFamily) viewNoFamily.classList.add('hidden');
  if (loadingElem) loadingElem.classList.add('hidden');
  if (boardElem) boardElem.classList.add('hidden');

  if (viewName === 'auth') {
    if (authLanding) authLanding.classList.remove('hidden');
  } else if (viewName === 'pending') {
    if (viewPendingApproval) viewPendingApproval.classList.remove('hidden');
  } else if (viewName === 'tablet-pending') {
    if (viewTabletPending) viewTabletPending.classList.remove('hidden');
  } else if (viewName === 'tablet-disconnected') {
    if (viewTabletDisconnected) viewTabletDisconnected.classList.remove('hidden');
  } else if (viewName === 'no-family') {
    if (viewNoFamily) viewNoFamily.classList.remove('hidden');
  } else if (viewName === 'loading') {
    if (loadingElem) loadingElem.classList.remove('hidden');
  } else if (viewName === 'board') {
    if (boardElem) boardElem.classList.remove('hidden');
  }
}

// User Authentication Actions
export async function triggerGoogleLogin() {
  try {
    showToast('מתחבר ל-Google...');
    const result = await loginWithGoogle();
    showToast(`ברוך הבא, ${result.user.displayName || 'משתמש'}!`);
  } catch (error) {
    console.error('[Auth Error] Google login failed:', error);
    showToast(error.message || 'שגיאה בהתחברות ל-Google', true);
  }
}
window.triggerGoogleLogin = triggerGoogleLogin;

export async function triggerLogout() {
  if (!confirm('האם אתה בטוח שברצונך להתנתק?')) return;
  if (familyUnsubscribe) familyUnsubscribe();
  if (userProfileUnsubscribe) userProfileUnsubscribe();
  await logoutUser();
  currentUser = null;
  currentFamilyId = null;
  setStoredFamilyId(null);
  showView('auth');
  if (userProfileBar) userProfileBar.classList.add('hidden');
  if (familyTitleElem) familyTitleElem.classList.add('hidden');
  showToast('התנתקת בהצלחה');
}
window.triggerLogout = triggerLogout;

export async function triggerCancelJoin() {
  if (!currentUser) return;
  const code = pendingFamilyCodeDisplay?.innerText?.trim() || '';
  try {
    if (code) {
      await cancelJoinRequest(currentUser.uid, code);
    }
    showToast('בקשת ההצטרפות בוטלה');
    showView('no-family');
  } catch (e) {
    showToast(e.message, true);
  }
}
window.triggerCancelJoin = triggerCancelJoin;

window.triggerDirectJoin = async function() {
  const input = document.getElementById('direct-join-code-input');
  const code = input?.value?.trim();
  if (!code) {
    showToast('נא להזין קוד משפחה', true);
    return;
  }
  if (!currentUser) {
    showToast('יש להתחבר עם Google תחילה', true);
    return;
  }

  try {
    showToast('שולח בקשת הצטרפות למנהל המשפחה...');
    const result = await requestJoinFamily(currentUser.uid, currentUser, code);
    if (result.status === 'already_approved') {
      showToast('הנך כבר חבר מאושר במשפחה זו! 🎉');
      loadFamilyBoard(code);
    } else {
      showToast('בקשת ההצטרפות נשלחה וממתינה לאישור מנהל המשפחה 🔒');
      if (pendingFamilyCodeDisplay) pendingFamilyCodeDisplay.innerText = code;
      showView('pending');
    }
  } catch (e) {
    showToast(e.message, true);
  }
};

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
    showToast(err.message || 'שגיאה בעדכון משימה', true);
  } finally {
    setTimeout(() => {
      pendingToggles.delete(toggleKey);
    }, 300);
  }
}
window.onTaskClick = onTaskClick;

export function renderBoard(data) {
  currentData = data;
  showView('board');
  updateTvBadge(data);

  if (familyTitleElem && data.name) {
    familyTitleElem.innerText = data.name;
    familyTitleElem.classList.remove('hidden');
  }

  if (!data || !data.children || data.children.length === 0) {
    boardElem.innerHTML = `
      <div class="col-span-full text-center py-16 bg-slate-900/60 rounded-3xl border border-slate-800">
        <p class="text-slate-400 text-xl font-bold mb-3">עדיין לא הוגדרו ילדים בלוח</p>
        <a href="/parent.html" class="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition">
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

function getActiveTabletToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');
  if (urlToken && urlToken.trim()) {
    localStorage.setItem('kids_tasker_tablet_token', urlToken.trim());
    return urlToken.trim();
  }
  return (localStorage.getItem('kids_tasker_tablet_token') || '').trim();
}

function loadFamilyBoard(familyId, tokenCandidate = null) {
  currentFamilyId = familyId;
  setStoredFamilyId(familyId);

  if (familyUnsubscribe) familyUnsubscribe();
  updateConnectionStatus(false);
  showView('loading');

  const activeToken = tokenCandidate || getActiveTabletToken();

  familyUnsubscribe = subscribeToFamily(familyId, async data => {
    const currentUid = currentUser ? currentUser.uid : null;
    const deviceId = getOrCreateDeviceId();
    const approvedTablets = data.tablets || [];
    const pendingTablets = data.pendingTablets || [];
    const isApprovedTablet = approvedTablets.some(t => t.id === deviceId);
    const isPendingTablet = pendingTablets.some(t => t.id === deviceId);

    // 1. Check if token matches family's tabletToken (Bypasses Google Auth for kids view)
    const isValidTabletToken = Boolean(activeToken && data.tabletToken && (activeToken === data.tabletToken));

    // 2. Auto-claim legacy or unowned family if Google user logged in
    if (!data.ownerUid && (!data.admins || data.admins.length === 0) && currentUser) {
      await claimFamilyIfUnowned(familyId, currentUser);
      data.ownerUid = currentUid;
      data.admins = [currentUid];
      data.parents = [currentUid];
    }

    // 3. Check Google Auth membership
    const isApprovedUser = Boolean(currentUser && (
      data.ownerUid === currentUid || 
      (data.admins || []).includes(currentUid) || 
      (data.parents || []).includes(currentUid) || 
      (data.members || []).some(m => m.uid === currentUid)
    ));

    // Check if this is an explicit parent preview on desktop/phone
    const urlParams = new URLSearchParams(window.location.search);
    const isParentPreview = urlParams.get('preview') === 'true' && isApprovedUser;

    // Show/hide preview badge
    const previewBadge = document.getElementById('parent-preview-badge');
    if (previewBadge) {
      if (isParentPreview) previewBadge.classList.remove('hidden');
      else previewBadge.classList.add('hidden');
    }

    console.log(`[Tablet Gate] Device: ${deviceId}, Family: ${familyId}, isApproved: ${isApprovedTablet}, isPending: ${isPendingTablet}, isPreview: ${isParentPreview}, validToken: ${isValidTabletToken}`);

    // STRICT TABLET SECURITY GATEKEEPER:
    // If NOT an explicit parent preview, this screen is in TABLET MODE.
    // The previous allowed method (Google login or unapproved token) is STRICTLY REMOVED.
    // Every tablet MUST be in data.tablets!
    if (!isParentPreview) {
      if (!isApprovedTablet) {
        // If the tablet WAS previously approved in this session, it was just removed by an admin!
        if (wasApprovedTablet) {
          console.warn(`[Security Gate] Tablet ${deviceId} was removed from approved tablets by admin! Disconnecting immediately.`);
          wasApprovedTablet = false;
          localStorage.removeItem('kids_tasker_tablet_token');
          showView('tablet-disconnected');
          showToast('הטאבלט נותק על ידי מנהל המשפחה 🔒', true);
          return; // STOP! Disconnected!
        }

        // Check if a valid QR token was provided
        if (!isValidTabletToken) {
          console.warn(`[Security Gate] Tablet access blocked. Invalid token or legacy allowed method.`);
          showView('auth');
          showToast('נדרש סריקת קוד QR עדכני מלוח ההורים 🔒', true);
          return;
        }

        // Valid token, but device not yet approved by admin:
        console.warn(`[Security Gate] Tablet ${deviceId} is pending approval in family ${familyId}.`);
        if (tabletFamilyDisplay) tabletFamilyDisplay.innerText = data.name || familyId;
        if (tabletDeviceIdDisplay) tabletDeviceIdDisplay.innerText = deviceId;

        // Auto-register to pendingTablets if not already pending
        if (!isPendingTablet) {
          try {
            await registerTabletRequest(familyId, {
              id: deviceId,
              token: activeToken,
              name: 'טאבלט חדש'
            });
          } catch (regErr) {
            console.error('Failed to register tablet request:', regErr);
          }
        }

        showView('tablet-pending');
        return; // STOP! Never render chores until approved in data.tablets!
      }

      // The tablet device is approved!
      wasApprovedTablet = true;

      // Tablet Kid Mode active
      const tabletBadge = document.getElementById('tablet-mode-badge');
      if (tabletBadge) tabletBadge.classList.remove('hidden');
      const parentNav = document.getElementById('btn-parent-nav');
      if (parentNav) {
        parentNav.title = 'ניהול הורים (מוגן בכניסת מנהל עם חשבון Google)';
      }

      // Hide parent user profile bar in tablet mode so kids cannot click it
      if (userProfileBar) userProfileBar.classList.add('hidden');
    }

    updateConnectionStatus(true);
    renderBoard(data);
  }, err => {
    updateConnectionStatus(false);
    console.error('[Tablet] Subscription error:', err);
    showToast('שגיאה בטעינת נתוני המשפחה או שאין הרשאת גישה', true);
  });
}

// Initialize Authentication & Realtime Listener
function init() {
  renderHebrewDate();
  updateConnectionStatus(false);
  showView('loading');

  // Check URL query parameters for family & tablet token
  const urlParams = new URLSearchParams(window.location.search);
  const urlFamily = urlParams.get('family');
  const urlToken = urlParams.get('token');
  const isParentPreview = urlParams.get('preview') === 'true';

  if (urlFamily && urlFamily.trim()) {
    setStoredFamilyId(urlFamily.trim());
    currentFamilyId = urlFamily.trim();
  }

  if (urlToken && urlToken.trim()) {
    localStorage.setItem('kids_tasker_tablet_token', urlToken.trim());
  }

  const activeToken = getActiveTabletToken();

  // If we have an active tablet token and family ID in Tablet Mode (not preview), load immediately
  if (activeToken && currentFamilyId && currentFamilyId !== 'demo-family' && !isParentPreview) {
    loadFamilyBoard(currentFamilyId, activeToken);
  }

  // Monitor Authentication State
  subscribeToAuth(user => {
    currentUser = user;

    if (!user) {
      // Not logged in with Google.
      // If we have a valid token from QR code/localStorage in tablet mode, load board
      if (activeToken && currentFamilyId && currentFamilyId !== 'demo-family' && !isParentPreview) {
        if (userProfileBar) userProfileBar.classList.add('hidden');
        return;
      }

      // No token and not logged in -> Auth Landing
      if (familyUnsubscribe) familyUnsubscribe();
      if (userProfileUnsubscribe) userProfileUnsubscribe();
      if (userProfileBar) userProfileBar.classList.add('hidden');
      if (familyTitleElem) familyTitleElem.classList.add('hidden');
      showView('auth');
      return;
    }

    // User is authenticated with Google:
    // Only show profile bar in Parent Preview mode!
    if (isParentPreview) {
      if (userProfileBar) userProfileBar.classList.remove('hidden');
      if (userAvatar && user.photoURL) {
        userAvatar.src = user.photoURL;
        userAvatar.classList.remove('hidden');
      }
      if (userDisplayName) {
        userDisplayName.innerText = user.displayName || user.email || 'הורה (תצוגה מקדימה)';
      }
    } else {
      if (userProfileBar) userProfileBar.classList.add('hidden');
    }

    // Subscribe to user profile in real-time
    if (userProfileUnsubscribe) userProfileUnsubscribe();
    userProfileUnsubscribe = subscribeToUserProfile(user.uid, profile => {
      // In parent preview mode:
      if (isParentPreview) {
        if (profile && profile.status === 'pending') {
          if (pendingFamilyCodeDisplay) {
            pendingFamilyCodeDisplay.innerText = profile.pendingFamilyId || '';
          }
          showView('pending');
          return;
        }

        const storedId = getStoredFamilyId();
        const targetFamilyId = (profile && profile.familyId) 
          ? profile.familyId 
          : (urlFamily && urlFamily.trim())
            ? urlFamily.trim()
            : (storedId && storedId !== 'demo-family')
              ? storedId
              : null;

        if (targetFamilyId) {
          loadFamilyBoard(targetFamilyId, activeToken);
        } else {
          showView('no-family');
        }
        return;
      }

      // In Tablet Mode:
      // The tablet board is loaded strictly with activeToken, requiring device approval in data.tablets.
      if (activeToken && currentFamilyId && currentFamilyId !== 'demo-family') {
        loadFamilyBoard(currentFamilyId, activeToken);
      } else {
        showView('auth');
      }
    });
  });
}

// Recheck tablet approval action
window.recheckTabletApproval = async function() {
  showToast('בודק אישור מנהל...');
  const activeToken = getActiveTabletToken();
  if (currentFamilyId && currentFamilyId !== 'demo-family') {
    try {
      const deviceId = getOrCreateDeviceId();
      await registerTabletRequest(currentFamilyId, {
        id: deviceId,
        token: activeToken,
        name: 'טאבלט חדש'
      });
    } catch (e) {
      console.warn('[Recheck] Notice:', e);
    }
    loadFamilyBoard(currentFamilyId, activeToken);
    showToast('הנתונים עודכנו מול השרת ✨');
  } else {
    showToast('חסר קוד משפחה או טוקן', true);
  }
};

// Run init immediately if DOM is already ready (top-level await support)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

