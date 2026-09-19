// Parent Dashboard & Onboarding Controller (Modular Firebase Edition)
import { 
  getStoredFamilyId, 
  setStoredFamilyId, 
  loginWithGoogle, 
  logoutUser, 
  subscribeToAuth 
} from './firebase-config.js';
import { 
  subscribeToFamily, 
  subscribeToDailyHistory, 
  toggleTask, 
  addChild, 
  updateChild, 
  deleteChild, 
  addTask, 
  updateTask, 
  deleteTask, 
  resetDailyTasks, 
  setParentBypass, 
  saveHomeAssistantConfig, 
  calculateCompletionStatus, 
  getTodayDateString, 
  getUserProfile, 
  subscribeToUserProfile,
  createFamilyForUser, 
  requestJoinFamily,
  cancelJoinRequest,
  approveMember,
  rejectMember,
  updateMemberRole,
  removeMember,
  updateFamilyName,
  claimFamilyIfUnowned,
  getOrCreateTabletToken,
  regenerateTabletToken,
  approveTablet,
  rejectTablet,
  removeTablet,
  updateTabletName,
  ICON_LABELS 
} from './db.js';

let currentFamilyId = getStoredFamilyId();
let currentData = null;
let currentTab = 'status';
let currentUser = null;
let familyUnsubscribe = null;
let userProfileUnsubscribe = null;

// DOM View Containers
const authLanding = document.getElementById('auth-landing');
const onboardingWizard = document.getElementById('onboarding-wizard');
const viewPendingApproval = document.getElementById('view-pending-approval');
const appDashboard = document.getElementById('app-dashboard');
const pendingFamilyCodeDisplay = document.getElementById('pending-family-code-display');

// Header elements
const statusBadge = document.getElementById('status-badge');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const familyIdDisplay = document.getElementById('family-id-display');
const dashboardFamilyName = document.getElementById('dashboard-family-name');
const userAvatar = document.getElementById('user-avatar');
const userDisplayName = document.getElementById('user-display-name');

function updateConnectionStatus(isConnected) {
  if (!statusBadge || !statusDot || !statusText) return;
  if (isConnected) {
    statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50';
    statusText.innerText = 'מחובר';
    statusBadge.className = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/60 border border-emerald-800/60 text-emerald-300';
  } else {
    statusDot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-pulse';
    statusText.innerText = 'מתחבר...';
    statusBadge.className = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-950/60 border border-rose-800/60 text-rose-300';
  }
}

export function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = message;
  toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3.5 rounded-2xl shadow-2xl text-white font-bold transition-all duration-300 z-50 text-sm flex items-center gap-2 border ${
    isError ? 'bg-rose-600 border-rose-500 shadow-rose-950/50' : 'bg-emerald-600 border-emerald-500 shadow-emerald-950/50'
  }`;
  toast.classList.remove('hidden', 'opacity-0');
  toast.classList.add('opacity-100');
  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3000);
}

// ==========================================
// Authentication & View Switching
// ==========================================

export async function triggerGoogleLogin() {
  try {
    showToast('מתחבר ל-Google...');
    const result = await loginWithGoogle();
    const user = result.user;
    showToast(`ברוך הבא, ${user.displayName || 'משתמש'}!`);
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
  showToast('התנתקת בהצלחה');
}
window.triggerLogout = triggerLogout;

export async function triggerJoinFamilyWithCode(code) {
  const cleanCode = (code || '').trim();
  if (!cleanCode) {
    showToast('נא להזין קוד משפחה', true);
    return;
  }

  if (!currentUser) {
    showToast('יש להתחבר עם Google תחילה כדי להצטרף למשפחה');
    sessionStorage.setItem('pending_join_code', cleanCode);
    await triggerGoogleLogin();
    return;
  }

  try {
    showToast('שולח בקשת הצטרפות למנהל המשפחה...');
    const result = await requestJoinFamily(currentUser.uid, currentUser, cleanCode);
    if (result.status === 'already_approved') {
      showToast('הנך כבר חבר מאושר במשפחה זו! 🎉');
      loadDashboardForFamily(cleanCode);
    } else {
      showToast('בקשת ההצטרפות נשלחה וממתינה לאישור מנהל המשפחה 🔒');
      if (pendingFamilyCodeDisplay) pendingFamilyCodeDisplay.innerText = cleanCode;
      showView('pending');
    }
  } catch (e) {
    showToast(e.message, true);
  }
}
window.triggerJoinFamilyWithCode = triggerJoinFamilyWithCode;

export async function triggerJoinFamily() {
  const input = document.getElementById('join-family-code-input');
  const code = input?.value?.trim();
  await triggerJoinFamilyWithCode(code);
}
window.triggerJoinFamily = triggerJoinFamily;

window.triggerJoinFromWizard = function() {
  const input = document.getElementById('wizard-join-code-input');
  const code = input?.value?.trim();
  triggerJoinFamilyWithCode(code);
};

window.switchOnboardingMode = function(mode) {
  const btnCreate = document.getElementById('btn-mode-create');
  const btnJoin = document.getElementById('btn-mode-join');
  const containerCreate = document.getElementById('wizard-create-container');
  const containerJoin = document.getElementById('wizard-join-container');

  if (mode === 'join') {
    if (btnCreate) btnCreate.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition text-slate-400 hover:text-white';
    if (btnJoin) btnJoin.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition bg-indigo-600 text-white shadow';
    if (containerCreate) containerCreate.classList.add('hidden');
    if (containerJoin) containerJoin.classList.remove('hidden');
    const input = document.getElementById('wizard-join-code-input');
    if (input) input.focus();
  } else {
    if (btnCreate) btnCreate.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition bg-indigo-600 text-white shadow';
    if (btnJoin) btnJoin.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition text-slate-400 hover:text-white';
    if (containerCreate) containerCreate.classList.remove('hidden');
    if (containerJoin) containerJoin.classList.add('hidden');
  }
};

export async function triggerCancelJoin() {
  if (!currentUser) return;
  const code = pendingFamilyCodeDisplay?.innerText?.trim() || '';
  try {
    if (code) {
      await cancelJoinRequest(currentUser.uid, code);
    }
    showToast('בקשת ההצטרפות בוטלה');
    showView('onboarding');
  } catch (e) {
    showToast(e.message, true);
  }
}
window.triggerCancelJoin = triggerCancelJoin;

function showView(viewName) {
  authLanding.classList.add('hidden');
  onboardingWizard.classList.add('hidden');
  if (viewPendingApproval) viewPendingApproval.classList.add('hidden');
  appDashboard.classList.add('hidden');

  if (viewName === 'auth') {
    authLanding.classList.remove('hidden');
  } else if (viewName === 'onboarding') {
    onboardingWizard.classList.remove('hidden');
  } else if (viewName === 'pending') {
    if (viewPendingApproval) viewPendingApproval.classList.remove('hidden');
  } else if (viewName === 'dashboard') {
    appDashboard.classList.remove('hidden');
  }
}

// ==========================================
// Onboarding Wizard Flow
// ==========================================

window.wizardGoToStep1 = function() {
  document.getElementById('wizard-step-1').classList.remove('hidden');
  document.getElementById('wizard-step-2').classList.add('hidden');
  document.getElementById('wizard-step-3').classList.add('hidden');
  document.getElementById('dot-step-1').className = 'w-3 h-3 rounded-full bg-indigo-500';
  document.getElementById('dot-step-2').className = 'w-3 h-3 rounded-full bg-slate-800';
  document.getElementById('dot-step-3').className = 'w-3 h-3 rounded-full bg-slate-800';
};

window.wizardGoToStep2 = function() {
  const nameInput = document.getElementById('wizard-family-name');
  if (!nameInput?.value?.trim()) {
    showToast('נא להזין שם למשפחה', true);
    nameInput.focus();
    return;
  }
  document.getElementById('wizard-step-1').classList.add('hidden');
  document.getElementById('wizard-step-2').classList.remove('hidden');
  document.getElementById('wizard-step-3').classList.add('hidden');
  document.getElementById('dot-step-1').className = 'w-3 h-3 rounded-full bg-emerald-500';
  document.getElementById('dot-step-2').className = 'w-3 h-3 rounded-full bg-indigo-500';
  document.getElementById('dot-step-3').className = 'w-3 h-3 rounded-full bg-slate-800';
};

window.wizardAddChildInput = function() {
  const container = document.getElementById('wizard-children-inputs');
  const count = container.querySelectorAll('.wizard-child-name').length + 1;
  const div = document.createElement('div');
  div.className = 'flex items-center gap-2';
  div.innerHTML = `
    <input 
      type="text" 
      placeholder="שם הילד/ה הבא (ילד ${count})..." 
      class="wizard-child-name flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white"
    >
    <button type="button" onclick="this.parentElement.remove()" class="text-slate-500 hover:text-rose-400 p-2 text-sm">✖</button>
  `;
  container.appendChild(div);
};

window.wizardSubmitFamily = async function() {
  const familyName = document.getElementById('wizard-family-name')?.value?.trim();
  const childInputs = document.querySelectorAll('.wizard-child-name');
  const childrenNames = [];
  childInputs.forEach(input => {
    if (input.value.trim()) childrenNames.push(input.value.trim());
  });

  if (childrenNames.length === 0) {
    showToast('נא להזין לפחות שם של ילד אחד', true);
    return;
  }

  const btn = document.getElementById('wizard-create-btn');
  btn.disabled = true;
  btn.innerText = 'מקים את הלוח בענן...';

  try {
    const { familyId } = await createFamilyForUser(currentUser.uid, currentUser, familyName, childrenNames);
    currentFamilyId = familyId;
    setStoredFamilyId(familyId);

    // Show Step 3 (Success)
    document.getElementById('wizard-step-1').classList.add('hidden');
    document.getElementById('wizard-step-2').classList.add('hidden');
    document.getElementById('wizard-step-3').classList.remove('hidden');
    document.getElementById('dot-step-2').className = 'w-3 h-3 rounded-full bg-emerald-500';
    document.getElementById('dot-step-3').className = 'w-3 h-3 rounded-full bg-emerald-500';

    document.getElementById('wizard-result-family-id').innerText = familyId;
    const token = await getOrCreateTabletToken(familyId);
    const tabletUrl = `${window.location.origin}/index.html?family=${encodeURIComponent(familyId)}&token=${encodeURIComponent(token)}`;
    const qrImg = document.getElementById('wizard-qr-img');
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(tabletUrl)}`;
    }
  } catch (e) {
    showToast(e.message, true);
    btn.disabled = false;
    btn.innerText = 'צור לוח משפחתי 🚀';
  }
};

window.copyFamilyId = function() {
  const id = document.getElementById('wizard-result-family-id')?.innerText;
  if (id) {
    navigator.clipboard.writeText(id);
    showToast('קוד המשפחה הועתק ללוח!');
  }
};

window.copyTabletUrl = async function() {
  try {
    const token = await getOrCreateTabletToken(currentFamilyId);
    const tabletUrl = `${window.location.origin}/index.html?family=${encodeURIComponent(currentFamilyId)}&token=${encodeURIComponent(token)}`;
    navigator.clipboard.writeText(tabletUrl);
    showToast('הקישור המאובטח לטאבלט הועתק! שלח אותו או פתח בטאבלט.');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.finishOnboarding = function() {
  loadDashboardForFamily(currentFamilyId);
};

// ==========================================
// Tablet Pairing Modal
// ==========================================

window.openPairModal = async function() {
  const modal = document.getElementById('modal-pair-tablet');
  const urlInput = document.getElementById('pair-tablet-url');
  const qrImg = document.getElementById('pair-qr-img');

  try {
    const token = await getOrCreateTabletToken(currentFamilyId);
    const tabletUrl = `${window.location.origin}/index.html?family=${encodeURIComponent(currentFamilyId)}&token=${encodeURIComponent(token)}`;

    if (urlInput) urlInput.value = tabletUrl;
    if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(tabletUrl)}`;
    if (modal) modal.classList.remove('hidden');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.closePairModal = function() {
  const modal = document.getElementById('modal-pair-tablet');
  if (modal) modal.classList.add('hidden');
};

window.copyPairTabletUrl = function() {
  const urlInput = document.getElementById('pair-tablet-url');
  if (urlInput) {
    navigator.clipboard.writeText(urlInput.value);
    showToast('הקישור לטאבלט הועתק בהצלחה!');
  }
};

window.handleRegenerateTabletToken = async function() {
  if (!confirm('האם ליצור טוקן חדש? שים לב: טאבלטים שכבר חוברו בעבר יידרשו לסרוק מחדש את קוד ה-QR.')) return;
  try {
    showToast('מייצר טוקן מאובטח חדש...');
    const token = await regenerateTabletToken(currentFamilyId);
    const tabletUrl = `${window.location.origin}/index.html?family=${encodeURIComponent(currentFamilyId)}&token=${encodeURIComponent(token)}`;
    const urlInput = document.getElementById('pair-tablet-url');
    const qrImg = document.getElementById('pair-qr-img');
    if (urlInput) urlInput.value = tabletUrl;
    if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(tabletUrl)}`;
    showToast('טוקן טאבלט חדש נוצר בהצלחה! 📱');
  } catch (e) {
    showToast(e.message, true);
  }
};

// ==========================================
// Dashboard Logic
// ==========================================

export function switchTab(tabId) {
  currentTab = tabId;
  const tabs = ['status', 'manage', 'history', 'hass', 'family'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const view = document.getElementById(`view-${t}`);
    if (btn && view) {
      if (t === tabId) {
        btn.className = 'px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-indigo-600 text-white shadow-md';
        view.classList.remove('hidden');
      } else {
        btn.className = 'px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800/60';
        view.classList.add('hidden');
      }
    }
  });

  if (tabId === 'history') {
    loadHistory(document.getElementById('history-date-select')?.value || getTodayDateString());
  }
}
window.switchTab = switchTab;

function renderStatusTab(data) {
  const stats = calculateCompletionStatus(data);
  document.getElementById('stat-total').innerText = stats.totalTasks;
  document.getElementById('stat-completed').innerText = stats.completedTasks;
  document.getElementById('stat-remaining').innerText = stats.remainingTasks;
  document.getElementById('stat-percentage').innerText = `${stats.percentage}%`;

  const hass = data.homeAssistant || {};
  const isBypass = Boolean(hass.parentBypass);
  const tvBlocked = hass.enabled && !stats.allCompleted && !isBypass;

  const tvBadge = document.getElementById('stat-tv-status');
  if (tvBadge) {
    if (!hass.enabled) {
      tvBadge.innerText = 'כבוי';
      tvBadge.className = 'text-slate-400 font-bold';
    } else if (isBypass) {
      tvBadge.innerText = 'מעקף הורים 🔓';
      tvBadge.className = 'text-purple-400 font-bold animate-pulse';
    } else if (tvBlocked) {
      tvBadge.innerText = 'חסום 🔒';
      tvBadge.className = 'text-rose-400 font-bold';
    } else {
      tvBadge.innerText = 'מותר 🎉';
      tvBadge.className = 'text-emerald-400 font-bold';
    }
  }

  const container = document.getElementById('status-children-list');
  if (!container) return;

  if (!data.children || data.children.length === 0) {
    container.innerHTML = '<p class="text-slate-500 text-center py-8">אין ילדים מוגדרים</p>';
    return;
  }

  container.innerHTML = data.children.map(child => {
    const tasks = child.tasks || [];
    const completed = tasks.filter(t => t.completed).length;
    return `
      <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div class="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <h3 class="text-xl font-bold text-white flex items-center gap-2">
            <span>${child.name}</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">${completed}/${tasks.length} בוצעו</span>
          </h3>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          ${tasks.map(task => `
            <button 
              onclick="window.toggleTaskParent('${child.id}', '${task.id}')"
              class="p-3 rounded-xl border text-right flex items-center justify-between gap-2 transition ${
                task.completed ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200' : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              }"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <img src="/icons/${task.icon || 'star'}.svg" class="w-7 h-7 object-contain" onerror="this.src='/icons/star.svg'">
                <span class="truncate font-semibold text-sm ${task.completed ? 'line-through text-emerald-300/80' : ''}">${task.title}</span>
              </div>
              <span class="text-xs px-2 py-1 rounded-lg font-bold ${
                task.completed ? 'bg-emerald-800/80 text-emerald-100' : 'bg-slate-700 text-slate-300'
              }">${task.completed ? 'בוצע ✔' : 'ממתין'}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderManageTab(data) {
  const container = document.getElementById('manage-children-list');
  if (!container) return;

  if (!data.children || data.children.length === 0) {
    container.innerHTML = '<p class="text-slate-500 text-center py-8">עדיין לא הוספת ילדים. השתמש בטופס למעלה להוספת ילד!</p>';
    return;
  }

  container.innerHTML = data.children.map(child => `
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div class="flex items-center gap-3">
          <input 
            type="text" 
            value="${child.name}" 
            onchange="window.saveChildName('${child.id}', this.value)"
            class="text-xl font-bold bg-slate-800 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-1.5 text-white"
          >
        </div>
        <button 
          onclick="window.removeChild('${child.id}', '${child.name}')" 
          class="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800/60 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
        >
          <span>🗑️</span>
          <span>מחק ילד</span>
        </button>
      </div>

      <form onsubmit="window.handleAddTask(event, '${child.id}')" class="flex flex-wrap gap-2.5 items-center">
        <input 
          type="text" 
          placeholder="שם משימה חדשה..." 
          required
          id="new-task-title-${child.id}"
          class="flex-1 min-w-[200px] bg-slate-800 border border-slate-700 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500"
        >
        <select 
          id="new-task-icon-${child.id}"
          class="bg-slate-800 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-sm text-white"
        >
          <option value="">בחר אייקון (אוטומטי)</option>
          ${Object.entries(ICON_LABELS).map(([k, v]) => `
            <option value="${k}">${v.emoji} ${v.name}</option>
          `).join('')}
        </select>
        <button type="submit" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition flex items-center gap-1.5">
          <span>➕</span>
          <span>הוסף</span>
        </button>
      </form>

      <div class="space-y-2.5">
        ${(child.tasks || []).map(task => `
          <div class="flex items-center justify-between gap-3 p-3 bg-slate-800/40 border border-slate-800 rounded-xl hover:border-slate-700 transition">
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <select 
                onchange="window.saveTaskIcon('${child.id}', '${task.id}', this.value)"
                class="bg-slate-800 border border-slate-700 rounded-lg p-1.5 text-xs text-white"
              >
                ${Object.entries(ICON_LABELS).map(([k, v]) => `
                  <option value="${k}" ${task.icon === k ? 'selected' : ''}>${v.emoji} ${v.name}</option>
                `).join('')}
              </select>
              <input 
                type="text" 
                value="${task.title}" 
                onchange="window.saveTaskTitle('${child.id}', '${task.id}', this.value)"
                class="bg-transparent border-b border-transparent focus:border-indigo-500 text-sm font-semibold text-white px-1 py-0.5 flex-1 min-w-0"
              >
            </div>
            <button 
              onclick="window.removeTask('${child.id}', '${task.id}')"
              class="text-slate-500 hover:text-rose-400 p-1.5 transition text-sm"
              title="מחק משימה"
            >
              ✖
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderHassTab(data) {
  const hass = data.homeAssistant || {};
  document.getElementById('hass-enabled').checked = Boolean(hass.enabled);
  document.getElementById('hass-url').value = hass.url || 'http://homeassistant.local:8123';
  document.getElementById('hass-token').value = hass.token || '';
  document.getElementById('hass-entity').value = hass.tvEntityId || 'switch.tv_socket';
  document.getElementById('hass-autoblock').checked = Boolean(hass.autoBlockTv !== false);

  const bypassBtn = document.getElementById('hass-bypass-toggle-btn');
  if (bypassBtn) {
    if (hass.parentBypass) {
      bypassBtn.className = 'px-4 py-2.5 rounded-xl font-bold text-sm bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 shadow-lg shadow-purple-900/30 transition flex items-center gap-2';
      bypassBtn.innerHTML = '<span>🔓</span><span>מעקף פעיל (הטלוויזיה מותרת) - לחץ לכיבוי</span>';
    } else {
      bypassBtn.className = 'px-4 py-2.5 rounded-xl font-bold text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-2';
      bypassBtn.innerHTML = '<span>🔒</span><span>מעקף כבוי (חוקים רגילים) - לחץ להפעלה</span>';
    }
  }
}

// Render Tab 5: Family Members & Approvals
function renderFamilyTab(data) {
  const currentUid = currentUser ? currentUser.uid : null;
  const isOwner = data.ownerUid === currentUid;
  const isAdmin = isOwner || (data.admins || []).includes(currentUid);

  const pendingList = data.pendingMembers || [];
  const membersList = data.members || [];

  // Update Pending Count Badge
  const countBadge = document.getElementById('pending-count-badge');
  if (countBadge) {
    if (pendingList.length > 0) {
      countBadge.innerText = `${pendingList.length} ממתינים`;
      countBadge.classList.remove('hidden');
    } else {
      countBadge.classList.add('hidden');
    }
  }

  // 0. Update Family Name input
  const nameInput = document.getElementById('edit-family-name-input');
  if (nameInput && data.name && document.activeElement !== nameInput) {
    nameInput.value = data.name;
  }

  // 1. Pending Members Section
  const pendingContainer = document.getElementById('pending-members-list');
  if (pendingContainer) {
    if (pendingList.length === 0) {
      pendingContainer.innerHTML = '<p class="text-slate-500 text-sm py-2">אין בקשות הצטרפות ממתינות כרגע ✨</p>';
    } else {
      pendingContainer.innerHTML = pendingList.map(p => `
        <div class="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-800/60 border border-slate-700/80 rounded-2xl">
          <div class="flex items-center gap-3">
            <img src="${p.photoURL || '/icons/star.svg'}" class="w-10 h-10 rounded-full object-cover border border-indigo-500/30" onerror="this.src='/icons/star.svg'">
            <div>
              <div class="font-bold text-white text-sm flex items-center gap-1.5">
                <span>${p.displayName || 'משתמש חדש'}</span>
                <span class="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">ממתין לאישור</span>
              </div>
              <div class="text-xs text-slate-400 font-mono">${p.email || ''}</div>
            </div>
          </div>

          ${isAdmin ? `
            <div class="flex items-center gap-2">
              <button onclick="window.handleApproveMember('${p.uid}', 'parent')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-1">
                <span>✔</span>
                <span>אשר כהורה</span>
              </button>
              <button onclick="window.handleApproveMember('${p.uid}', 'admin')" class="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-1">
                <span>👑</span>
                <span>אשר כמנהל</span>
              </button>
              <button onclick="window.handleRejectMember('${p.uid}')" class="px-2.5 py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-200 border border-slate-700 rounded-xl text-xs font-bold transition">
                דחה ✖
              </button>
            </div>
          ` : `
            <span class="text-xs text-slate-500 italic">ממתין לאישור מנהל המשפחה</span>
          `}
        </div>
      `).join('');
    }
  }

  // 2. Active Members Section
  const membersContainer = document.getElementById('active-members-list');
  if (membersContainer) {
    if (membersList.length === 0) {
      membersContainer.innerHTML = '<p class="text-slate-500 text-sm py-2">אין חברים רשומים</p>';
    } else {
      membersContainer.innerHTML = membersList.map(m => {
        const isMemberOwner = data.ownerUid === m.uid;
        const isMemberAdmin = isMemberOwner || (data.admins || []).includes(m.uid);
        const isSelf = m.uid === currentUid;

        let roleBadge = '<span class="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">הורה</span>';
        if (isMemberOwner) {
          roleBadge = '<span class="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-950 text-purple-300 border border-purple-700 flex items-center gap-1"><span>👑</span><span>מנהל ראשי</span></span>';
        } else if (isMemberAdmin) {
          roleBadge = '<span class="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-700 flex items-center gap-1"><span>⭐</span><span>מנהל</span></span>';
        }

        return `
          <div class="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-800/40 border border-slate-800 rounded-2xl hover:border-slate-700 transition">
            <div class="flex items-center gap-3">
              <img src="${m.photoURL || '/icons/star.svg'}" class="w-10 h-10 rounded-full object-cover border border-slate-700" onerror="this.src='/icons/star.svg'">
              <div>
                <div class="font-bold text-white text-sm flex items-center gap-2">
                  <span>${m.displayName || 'משתמש'}</span>
                  ${isSelf ? '<span class="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-medium">(אתה)</span>' : ''}
                </div>
                <div class="text-xs text-slate-400 font-mono">${m.email || ''}</div>
              </div>
            </div>

            <div class="flex items-center gap-2.5">
              ${roleBadge}

              ${isAdmin && !isMemberOwner && !isSelf ? `
                <button 
                  onclick="window.handleToggleMemberRole('${m.uid}', '${isMemberAdmin ? 'parent' : 'admin'}')" 
                  class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition"
                  title="${isMemberAdmin ? 'הורד לדרגת הורה' : 'קדם לדרגת מנהל'}"
                >
                  ${isMemberAdmin ? 'בטל מנהל' : 'הפוך למנהל'}
                </button>
                <button 
                  onclick="window.handleRemoveMember('${m.uid}', '${m.displayName || m.email || 'משתמש'}')" 
                  class="px-2.5 py-1 bg-rose-950/50 hover:bg-rose-900 text-rose-300 border border-rose-800/60 rounded-xl text-xs font-semibold transition"
                  title="הסר מהמשפחה"
                >
                  הסר
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2.5. Pending Tablets Section
  const pendingTablets = data.pendingTablets || [];
  const pendingTabletsBadge = document.getElementById('pending-tablets-count-badge');
  if (pendingTabletsBadge) {
    if (pendingTablets.length > 0) {
      pendingTabletsBadge.innerText = `${pendingTablets.length} ממתינים`;
      pendingTabletsBadge.classList.remove('hidden');
    } else {
      pendingTabletsBadge.classList.add('hidden');
    }
  }

  const pendingTabletsContainer = document.getElementById('pending-tablets-list');
  if (pendingTabletsContainer) {
    if (pendingTablets.length === 0) {
      pendingTabletsContainer.innerHTML = '<p class="text-slate-500 text-sm py-2">אין טאבלטים הממתינים לאישור כרגע ✨</p>';
    } else {
      pendingTabletsContainer.innerHTML = pendingTablets.map(t => {
        const reqTime = t.requestedAt ? new Date(t.requestedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
        return `
          <div class="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-amber-950/20 border border-amber-800/40 rounded-2xl">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center text-xl">
                📱
              </div>
              <div>
                <div class="font-bold text-white text-sm flex items-center gap-2">
                  <input 
                    type="text" 
                    id="pending-tablet-name-${t.id}" 
                    value="${t.name || 'טאבלט סלון'}" 
                    placeholder="שם הטאבלט (למשל: טאבלט סלון)..."
                    class="bg-slate-800 border border-slate-700 focus:border-amber-500 rounded-lg px-2.5 py-1 text-xs text-white max-w-[170px]"
                    title="שם המכשיר"
                  >
                  <span class="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold">ממתין לאישור</span>
                </div>
                <div class="text-[11px] text-slate-400 font-mono mt-0.5">
                  <span>מזהה מכשיר: ${t.id}</span>
                  ${reqTime ? `<span class="mx-1">•</span><span>ביקש: ${reqTime}</span>` : ''}
                </div>
              </div>
            </div>

            ${isAdmin ? `
              <div class="flex items-center gap-2">
                <button 
                  onclick="window.handleApproveTablet('${t.id}')" 
                  class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-1"
                >
                  <span>✔</span>
                  <span>אשר טאבלט</span>
                </button>
                <button 
                  onclick="window.handleRejectTablet('${t.id}')" 
                  class="px-2.5 py-1.5 bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-200 border border-slate-700 rounded-xl text-xs font-bold transition"
                >
                  דחה ✖
                </button>
              </div>
            ` : `
              <span class="text-xs text-slate-500 italic">ממתין לאישור מנהל המשפחה</span>
            `}
          </div>
        `;
      }).join('');
    }
  }

  // 2.6. Active Approved Tablets Section
  const activeTablets = data.tablets || [];
  const activeTabletsBadge = document.getElementById('active-tablets-count-badge');
  if (activeTabletsBadge) {
    if (activeTablets.length > 0) {
      activeTabletsBadge.innerText = `${activeTablets.length} פעילים`;
      activeTabletsBadge.classList.remove('hidden');
    } else {
      activeTabletsBadge.classList.add('hidden');
    }
  }

  const activeTabletsContainer = document.getElementById('active-tablets-list');
  if (activeTabletsContainer) {
    if (activeTablets.length === 0) {
      activeTabletsContainer.innerHTML = '<p class="text-slate-500 text-sm py-2">עדיין לא חוברו טאבלטים מאושרים. לחץ על "חבר טאבלט חדש" להצגת קוד ה-QR.</p>';
    } else {
      activeTabletsContainer.innerHTML = activeTablets.map(t => {
        const approvedTime = t.approvedAt ? new Date(t.approvedAt).toLocaleDateString('he-IL', { dateStyle: 'short' }) : '';
        return `
          <div class="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-800/40 border border-slate-800 rounded-2xl hover:border-slate-700 transition">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-xl">
                📱
              </div>
              <div>
                <div class="font-bold text-white text-sm flex items-center gap-2">
                  <input 
                    type="text" 
                    value="${t.name || 'טאבלט'}" 
                    onchange="window.handleUpdateTabletName('${t.id}', this.value)"
                    class="bg-transparent border-b border-transparent hover:border-slate-600 focus:border-indigo-500 text-sm font-bold text-white px-1 py-0.5 transition"
                    title="לחץ לעריכת שם הטאבלט"
                  >
                  <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                    <span>✔</span>
                    <span>מורשה</span>
                  </span>
                </div>
                <div class="text-[11px] text-slate-400 font-mono mt-0.5">
                  <span>מזהה מכשיר: ${t.id}</span>
                  ${approvedTime ? `<span class="mx-1">•</span><span>אושר: ${approvedTime}</span>` : ''}
                </div>
              </div>
            </div>

            ${isAdmin ? `
              <div class="flex items-center gap-2">
                <button 
                  onclick="window.handleRemoveTablet('${t.id}', '${(t.name || 'טאבלט').replace(/'/g, "\\'")}')" 
                  class="px-3 py-1.5 bg-rose-950/50 hover:bg-rose-900 text-rose-300 border border-rose-800/60 rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
                  title="נתק טאבלט זה מיד (יחסם ללא עיכוב)"
                >
                  <span>🗑️</span>
                  <span>נתק והסר</span>
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    }
  }

  // 3. Family Code badge
  const codeBadge = document.getElementById('family-code-badge');
  if (codeBadge) codeBadge.innerText = data.id || currentFamilyId;
}

window.copyFamilyCode = function() {
  const code = document.getElementById('family-code-badge')?.innerText;
  if (code) {
    navigator.clipboard.writeText(code);
    showToast('קוד המשפחה הועתק בהצלחה!');
  }
};

window.handleUpdateFamilyName = async function(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('edit-family-name-input');
  const newName = input?.value?.trim();
  if (!newName) {
    showToast('נא להזין שם למשפחה', true);
    return;
  }

  const btn = document.getElementById('btn-save-family-name');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'שומר...';
  }

  try {
    await updateFamilyName(currentFamilyId, newName);
    showToast(`שם המשפחה עודכן בהצלחה ל-"${newName}"! 🎉`);
    if (dashboardFamilyName) dashboardFamilyName.innerText = newName;
  } catch (err) {
    showToast(err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>💾</span><span>שמור שם</span>';
    }
  }
};

window.openEditFamilyNamePrompt = function() {
  switchTab('family');
  const input = document.getElementById('edit-family-name-input');
  if (input) {
    input.focus();
    input.select();
  }
};

// Admin Action Handlers
window.handleApproveMember = async function(targetUid, role) {
  try {
    showToast('מאשר חבר משפחה...');
    await approveMember(currentFamilyId, targetUid, role);
    showToast(role === 'admin' ? 'החבר אושר כמנהל! 👑' : 'החבר אושר כהורה! ✔');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.handleRejectMember = async function(targetUid) {
  if (!confirm('האם לדחות את בקשת ההצטרפות?')) return;
  try {
    await rejectMember(currentFamilyId, targetUid);
    showToast('בקשת ההצטרפות נדחתה');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.handleToggleMemberRole = async function(targetUid, newRole) {
  try {
    await updateMemberRole(currentFamilyId, targetUid, newRole);
    showToast(`הרשאת החבר עודכנה ל-${newRole === 'admin' ? 'מנהל' : 'הורה'}`);
  } catch (e) {
    showToast(e.message, true);
  }
};

window.handleRemoveMember = async function(targetUid, name) {
  if (!confirm(`האם אתה בטוח שברצונך להסיר את "${name}" מהמשפחה?`)) return;
  try {
    await removeMember(currentFamilyId, targetUid);
    showToast('החבר הוסר מהמשפחה');
  } catch (e) {
    showToast(e.message, true);
  }
};

// Tablet Handlers
window.handleApproveTablet = async function(tabletId) {
  try {
    const input = document.getElementById(`pending-tablet-name-${tabletId}`);
    const customName = input?.value?.trim() || 'טאבלט';
    showToast('מאשר טאבלט...');
    await approveTablet(currentFamilyId, tabletId, customName);
    showToast(`הטאבלט "${customName}" אושר בהצלחה! הלוח נפתח בטאבלט 🎉`);
  } catch (e) {
    showToast(e.message, true);
  }
};

window.handleRejectTablet = async function(tabletId) {
  if (!confirm('האם לדחות בקשת חיבור זו של הטאבלט?')) return;
  try {
    await rejectTablet(currentFamilyId, tabletId);
    showToast('בקשת הטאבלט נדחתה');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.handleRemoveTablet = async function(tabletId, tabletName) {
  if (!confirm(`האם לנתק ולהסיר את "${tabletName}" מרשימת הטאבלטים המאושרים?\nהטאבלט ינותק מידית ולוח המשימות ייחסם.`)) return;
  try {
    await removeTablet(currentFamilyId, tabletId);
    showToast(`הטאבלט "${tabletName}" נותק והוסר בהצלחה! 🔒`);
  } catch (e) {
    showToast(e.message, true);
  }
};

window.handleUpdateTabletName = async function(tabletId, newName) {
  if (!newName || !newName.trim()) return;
  try {
    await updateTabletName(currentFamilyId, tabletId, newName.trim());
    showToast('שם הטאבלט עודכן בהצלחה');
  } catch (e) {
    showToast(e.message, true);
  }
};


let historyUnsubscribe = null;
function loadHistory(dateString) {
  if (historyUnsubscribe) historyUnsubscribe();
  const listElem = document.getElementById('history-logs-list');
  if (!listElem) return;

  listElem.innerHTML = '<p class="text-slate-500 text-center py-6">טוען יומן היסטוריה...</p>';

  historyUnsubscribe = subscribeToDailyHistory(currentFamilyId, dateString, logs => {
    if (!logs || logs.length === 0) {
      listElem.innerHTML = '<p class="text-slate-500 text-center py-6">אין רשומות היסטוריה לתאריך זה</p>';
      return;
    }

    listElem.innerHTML = logs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const isDone = log.action === 'completed';
      return `
        <div class="flex items-center justify-between p-3 rounded-xl bg-slate-800/50 border border-slate-700/60 text-sm">
          <div class="flex items-center gap-3">
            <span class="text-xs font-mono text-slate-400">${time}</span>
            <img src="/icons/${log.icon || 'star'}.svg" class="w-6 h-6 object-contain" onerror="this.src='/icons/star.svg'">
            <span class="font-bold text-white">${log.childName}:</span>
            <span class="text-slate-200">${log.taskTitle}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs px-2 py-0.5 rounded-md font-bold ${
              isDone ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
            }">${isDone ? 'בוצע ✔' : 'בוטל'}</span>
            <span class="text-[10px] text-slate-400">על ידי ${log.by === 'parent' ? 'הורה' : 'ילד'}</span>
          </div>
        </div>
      `;
    }).join('');
  });
}

// Handlers for Parent Actions
window.toggleTaskParent = async function(childId, taskId) {
  try {
    await toggleTask(currentFamilyId, childId, taskId, true);
    showToast('סטטוס משימה עודכן');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.handleAddChild = async function(e) {
  e.preventDefault();
  const input = document.getElementById('new-child-name');
  const name = input?.value?.trim();
  if (!name) return;

  try {
    await addChild(currentFamilyId, name);
    input.value = '';
    showToast(`ילד "${name}" נוסף בהצלחה!`);
  } catch (e) {
    showToast(e.message, true);
  }
};

window.saveChildName = async function(childId, name) {
  if (!name.trim()) return;
  try {
    await updateChild(currentFamilyId, childId, name);
    showToast('שם עודכן');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.removeChild = async function(childId, name) {
  if (!confirm(`האם אתה בטוח שברצונך למחוק את "${name}" וכל משימותיו?`)) return;
  try {
    await deleteChild(currentFamilyId, childId);
    showToast('ילד נמחק');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.handleAddTask = async function(e, childId) {
  e.preventDefault();
  const titleInput = document.getElementById(`new-task-title-${childId}`);
  const iconInput = document.getElementById(`new-task-icon-${childId}`);
  const title = titleInput?.value?.trim();
  const icon = iconInput?.value;
  if (!title) return;

  try {
    await addTask(currentFamilyId, childId, title, icon);
    titleInput.value = '';
    showToast('משימה נוספה בהצלחה');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.saveTaskTitle = async function(childId, taskId, title) {
  if (!title.trim()) return;
  try {
    await updateTask(currentFamilyId, childId, taskId, title, null);
    showToast('כותרת משימה נשמרה');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.saveTaskIcon = async function(childId, taskId, icon) {
  try {
    await updateTask(currentFamilyId, childId, taskId, null, icon);
    showToast('אייקון משימה נשמר');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.removeTask = async function(childId, taskId) {
  if (!confirm('האם למחוק משימה זו?')) return;
  try {
    await deleteTask(currentFamilyId, childId, taskId);
    showToast('משימה נמחקה');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.confirmResetDay = async function() {
  if (!confirm('האם לאפס את משימות היום לסטטוס ממתין? שמות הילדים, המשימות וההיסטוריה יישמרו במלואם!')) return;
  try {
    await resetDailyTasks(currentFamilyId);
    showToast('יום חדש אופס בהצלחה!');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.toggleParentBypass = async function() {
  const current = Boolean(currentData?.homeAssistant?.parentBypass);
  try {
    await setParentBypass(currentFamilyId, !current);
    showToast(!current ? 'מעקף הורים הופעל' : 'מעקף הורים בוטל');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.saveHassSettings = async function(e) {
  e.preventDefault();
  const config = {
    enabled: document.getElementById('hass-enabled').checked,
    url: document.getElementById('hass-url').value.trim(),
    token: document.getElementById('hass-token').value.trim(),
    tvEntityId: document.getElementById('hass-entity').value.trim(),
    autoBlockTv: document.getElementById('hass-autoblock').checked,
    parentBypass: Boolean(currentData?.homeAssistant?.parentBypass)
  };

  try {
    await saveHomeAssistantConfig(currentFamilyId, config);
    showToast('הגדרות בית חכם נשמרו בהצלחה');
  } catch (e) {
    showToast(e.message, true);
  }
};

window.switchFamily = function() {
  const input = document.getElementById('active-family-id');
  const newId = input?.value?.trim();
  if (newId && newId !== currentFamilyId) {
    triggerJoinFamilyWithCode(newId);
  }
};

function loadDashboardForFamily(familyId) {
  currentFamilyId = familyId;
  setStoredFamilyId(familyId);

  if (familyIdDisplay) familyIdDisplay.innerText = familyId;

  const dateSelect = document.getElementById('history-date-select');
  if (dateSelect) {
    dateSelect.value = getTodayDateString();
    dateSelect.addEventListener('change', () => loadHistory(dateSelect.value));
  }

  if (familyUnsubscribe) familyUnsubscribe();
  updateConnectionStatus(false);

  familyUnsubscribe = subscribeToFamily(familyId, async data => {
    const currentUid = currentUser ? currentUser.uid : null;

    // Auto-claim legacy or unowned family for current user
    if (!data.ownerUid && (!data.admins || data.admins.length === 0) && currentUser) {
      await claimFamilyIfUnowned(familyId, currentUser);
      data.ownerUid = currentUid;
      data.admins = [currentUid];
      data.parents = [currentUid];
    }

    // STRICT SECURITY GATEKEEPER:
    // Verify that currentUser is actually an approved member or owner of this family!
    const isApproved = data.ownerUid === currentUid || 
                       (data.admins || []).includes(currentUid) || 
                       (data.parents || []).includes(currentUid) || 
                       (data.members || []).some(m => m.uid === currentUid);

    if (!isApproved) {
      console.warn(`[Security Gate] Access blocked to family ${familyId} for user ${currentUid}. User is not an approved member.`);
      const isPending = (data.pendingMembers || []).some(p => p.uid === currentUid);
      if (isPending) {
        if (pendingFamilyCodeDisplay) pendingFamilyCodeDisplay.innerText = familyId;
        showView('pending');
        showToast('הגישה ללוח חסומה עד לאישור מנהל המשפחה 🔒', true);
      } else {
        showView('onboarding');
        showToast('אינך חבר מאושר במשפחה זו. הגישה חסומה 🔒', true);
      }
      return; // STOP! Under NO circumstances render children, chores, history, or tokens!
    }

    currentData = data;
    updateConnectionStatus(true);
    showView('dashboard');
    if (dashboardFamilyName && data.name) {
      dashboardFamilyName.innerText = data.name;
    }
    renderStatusTab(data);
    renderManageTab(data);
    renderHassTab(data);
    renderFamilyTab(data);
  }, err => {
    updateConnectionStatus(false);
    console.error('[Parent] Subscription error:', err);
    showToast('שגיאה בטעינת נתוני המשפחה או שאין הרשאת גישה', true);
  });
}

// ==========================================
// Initialization
// ==========================================

function init() {
  updateConnectionStatus(false);

  // Monitor Authentication State
  subscribeToAuth(user => {
    currentUser = user;

    if (!user) {
      if (familyUnsubscribe) familyUnsubscribe();
      if (userProfileUnsubscribe) userProfileUnsubscribe();
      showView('auth');
      return;
    }

    // User is logged in with Google
    if (userAvatar && user.photoURL) {
      userAvatar.src = user.photoURL;
      userAvatar.classList.remove('hidden');
    }
    if (userDisplayName) {
      userDisplayName.innerText = user.displayName || user.email || 'הורה';
    }

    // Check if there was a pending join code from pre-auth landing page
    const pendingJoinCode = sessionStorage.getItem('pending_join_code');
    if (pendingJoinCode) {
      sessionStorage.removeItem('pending_join_code');
      triggerJoinFamilyWithCode(pendingJoinCode);
      return;
    }

    // Real-time listener on user profile
    if (userProfileUnsubscribe) userProfileUnsubscribe();
    userProfileUnsubscribe = subscribeToUserProfile(user.uid, profile => {
      if (profile && profile.status === 'pending') {
        // User requested to join and is waiting for admin approval -> Strictly BLOCK access
        if (pendingFamilyCodeDisplay) {
          pendingFamilyCodeDisplay.innerText = profile.pendingFamilyId || '';
        }
        showView('pending');
      } else if (profile && profile.status === 'approved' && profile.familyId) {
        // User is an approved family member/admin!
        loadDashboardForFamily(profile.familyId);
      } else if (profile && profile.status === 'rejected') {
        showToast('בקשת ההצטרפות שלך נדחתה על ידי מנהל המשפחה', true);
        showView('onboarding');
      } else {
        // New user without a family yet -> Onboarding wizard
        showView('onboarding');
        const nameInput = document.getElementById('wizard-family-name');
        if (nameInput && user.displayName) {
          const firstName = user.displayName.split(' ')[0];
          nameInput.value = `משפחת ${firstName}`;
        }
      }
    });
  });
}

// Top-level await safe ready trigger
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
