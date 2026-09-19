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
  createFamilyForUser, 
  joinFamilyWithCode, 
  ICON_LABELS 
} from './db.js';

let currentFamilyId = getStoredFamilyId();
let currentData = null;
let currentTab = 'status';
let currentUser = null;
let familyUnsubscribe = null;

// DOM View Containers
const authLanding = document.getElementById('auth-landing');
const onboardingWizard = document.getElementById('onboarding-wizard');
const appDashboard = document.getElementById('app-dashboard');

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
  await logoutUser();
  currentUser = null;
  currentFamilyId = null;
  setStoredFamilyId(null);
  showView('auth');
  showToast('התנתקת בהצלחה');
}
window.triggerLogout = triggerLogout;

export async function triggerJoinFamily() {
  const input = document.getElementById('join-family-code-input');
  const code = input?.value?.trim();
  if (!code) {
    showToast('נא להזין קוד משפחה', true);
    return;
  }

  if (!currentUser) {
    showToast('יש להתחבר עם Google קודם כדי להצטרף למשפחה');
    await triggerGoogleLogin();
    if (!currentUser) return;
  }

  try {
    showToast('מצטרף למשפחה...');
    await joinFamilyWithCode(currentUser.uid, currentUser, code);
    currentFamilyId = code;
    setStoredFamilyId(code);
    showToast('הצטרפת בהצלחה למשפחה! 🎉');
    loadDashboardForFamily(code);
  } catch (e) {
    showToast(e.message, true);
  }
}
window.triggerJoinFamily = triggerJoinFamily;

function showView(viewName) {
  authLanding.classList.add('hidden');
  onboardingWizard.classList.add('hidden');
  appDashboard.classList.add('hidden');

  if (viewName === 'auth') {
    authLanding.classList.remove('hidden');
  } else if (viewName === 'onboarding') {
    onboardingWizard.classList.remove('hidden');
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

    // Populate Success Screen
    document.getElementById('wizard-result-family-id').innerText = familyId;
    const tabletUrl = `${window.location.origin}/index.html?family=${familyId}`;
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

window.copyTabletUrl = function() {
  const tabletUrl = `${window.location.origin}/index.html?family=${currentFamilyId}`;
  navigator.clipboard.writeText(tabletUrl);
  showToast('הקישור לטאבלט הועתק! שלח אותו או פתח בטאבלט.');
};

window.finishOnboarding = function() {
  loadDashboardForFamily(currentFamilyId);
};

// ==========================================
// Tablet Pairing Modal
// ==========================================

window.openPairModal = function() {
  const modal = document.getElementById('modal-pair-tablet');
  const urlInput = document.getElementById('pair-tablet-url');
  const qrImg = document.getElementById('pair-qr-img');
  const tabletUrl = `${window.location.origin}/index.html?family=${currentFamilyId}`;

  if (urlInput) urlInput.value = tabletUrl;
  if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(tabletUrl)}`;
  if (modal) modal.classList.remove('hidden');
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
    setStoredFamilyId(newId);
    window.location.reload();
  }
};

function loadDashboardForFamily(familyId) {
  currentFamilyId = familyId;
  setStoredFamilyId(familyId);
  showView('dashboard');

  if (familyIdDisplay) familyIdDisplay.innerText = familyId;
  const codeBadge = document.getElementById('family-code-badge');
  if (codeBadge) codeBadge.innerText = familyId;

  const dateSelect = document.getElementById('history-date-select');
  if (dateSelect) {
    dateSelect.value = getTodayDateString();
    dateSelect.addEventListener('change', () => loadHistory(dateSelect.value));
  }

  if (familyUnsubscribe) familyUnsubscribe();
  updateConnectionStatus(false);

  familyUnsubscribe = subscribeToFamily(familyId, data => {
    currentData = data;
    updateConnectionStatus(true);
    if (dashboardFamilyName && data.name) {
      dashboardFamilyName.innerText = data.name;
    }
    renderStatusTab(data);
    renderManageTab(data);
    renderHassTab(data);
  }, err => {
    updateConnectionStatus(false);
    console.error('[Parent] Subscription error:', err);
  });
}

// ==========================================
// Initialization
// ==========================================

function init() {
  updateConnectionStatus(false);

  // Monitor Authentication State
  subscribeToAuth(async user => {
    currentUser = user;

    if (!user) {
      // User is logged out
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

    // Check user profile in Firestore
    const profile = await getUserProfile(user.uid);
    if (profile && profile.familyId) {
      // User has existing family
      loadDashboardForFamily(profile.familyId);
    } else {
      // New user -> Trigger Onboarding Wizard
      showView('onboarding');
      const nameInput = document.getElementById('wizard-family-name');
      if (nameInput && user.displayName) {
        const firstName = user.displayName.split(' ')[0];
        nameInput.value = `משפחת ${firstName}`;
      }
    }
  });
}

// Top-level await safe ready trigger
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
