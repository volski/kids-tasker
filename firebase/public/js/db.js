// Firestore Database Service for Kids Tasker (Multi-Tenant)
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  getDocs,
  serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { db } from './firebase-config.js';

// Helper: Today's date string YYYY-MM-DD
export function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Icon metadata catalog
export const ICON_LABELS = {
  toothbrush: { name: 'צחצוח שיניים', emoji: '🪥' },
  clothes: { name: 'התלבשות לבד', emoji: '👕' },
  backpack: { name: 'סידור תיק', emoji: '🎒' },
  bed: { name: 'סידור מיטה', emoji: '🛏️' },
  book: { name: 'קריאת ספר', emoji: '📖' },
  homework: { name: 'שיעורי בית', emoji: '✏️' },
  bath: { name: 'מקלחת', emoji: '🛁' },
  food: { name: 'ארוחה / אכילה', emoji: '🍽️' },
  toys: { name: 'סידור צעצועים', emoji: '🧸' },
  shoes: { name: 'נעילת נעליים', emoji: '👟' },
  water: { name: 'שתיית מים', emoji: '💧' },
  sleep: { name: 'שנת לילה', emoji: '🌙' },
  pet: { name: 'טיפול בחיה', emoji: '🐾' },
  hands: { name: 'שטיפת ידיים', emoji: '🧼' },
  star: { name: 'כללי / כוכב', emoji: '⭐' }
};

export function guessIconFromTitle(title) {
  if (!title) return 'star';
  if (title.includes('שיניים')) return 'toothbrush';
  if (title.includes('התלבשות') || title.includes('בגד')) return 'clothes';
  if (title.includes('תיק')) return 'backpack';
  if (title.includes('מיטה')) return 'bed';
  if (title.includes('ספר') || title.includes('קריאה')) return 'book';
  if (title.includes('שיעור') || title.includes('לימוד')) return 'homework';
  if (title.includes('מקלחת') || title.includes('אמבטיה')) return 'bath';
  if (title.includes('אוכל') || title.includes('בוקר') || title.includes('ערב') || title.includes('צהריים')) return 'food';
  if (title.includes('צעצוע') || title.includes('משחק') || title.includes('חדר')) return 'toys';
  if (title.includes('נעל')) return 'shoes';
  if (title.includes('מים') || title.includes('שתייה')) return 'water';
  if (title.includes('שינה') || title.includes('לילה')) return 'sleep';
  if (title.includes('חיה') || title.includes('כלב') || title.includes('חתול')) return 'pet';
  if (title.includes('ידיים') || title.includes('סבון')) return 'hands';
  return 'star';
}

// Generate secure random tablet token (long-lived pairing token)
export function generateTabletToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = 'tt_';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Default initial data template for new families
export function getDefaultFamilyData(familyName = 'משפחתנו') {
  return {
    name: familyName,
    tabletToken: generateTabletToken(),
    tablets: [],
    pendingTablets: [],
    createdAt: new Date().toISOString(),
    lastActiveDate: getTodayDateString(),
    children: [
      {
        id: "child_1",
        name: "ילד 1",
        tasks: [
          { id: "t1", title: "צחצוח שיניים", completed: false, completedAt: null, icon: "toothbrush" },
          { id: "t2", title: "התלבשות לבד", completed: false, completedAt: null, icon: "clothes" },
          { id: "t3", title: "סידור תיק", completed: false, completedAt: null, icon: "backpack" }
        ]
      },
      {
        id: "child_2",
        name: "ילד 2",
        tasks: [
          { id: "t1", title: "צחצוח שיניים", completed: false, completedAt: null, icon: "toothbrush" },
          { id: "t2", title: "התלבשות לבד", completed: false, completedAt: null, icon: "clothes" },
          { id: "t3", title: "סידור תיק", completed: false, completedAt: null, icon: "backpack" }
        ]
      }
    ],
    homeAssistant: {
      enabled: false,
      url: 'http://homeassistant.local:8123',
      token: '',
      tvEntityId: 'switch.tv_socket',
      autoBlockTv: true,
      pollIntervalSeconds: 30,
      targetScope: 'all',
      parentBypass: false
    }
  };
}

export function calculateCompletionStatus(data) {
  let totalTasks = 0;
  let completedTasks = 0;

  (data.children || []).forEach(child => {
    (child.tasks || []).forEach(task => {
      totalTasks++;
      if (task.completed) completedTasks++;
    });
  });

  const allCompleted = totalTasks > 0 && completedTasks === totalTasks;
  const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    allCompleted,
    totalTasks,
    completedTasks,
    remainingTasks: totalTasks - completedTasks,
    percentage
  };
}

// Subscribe to real-time family updates
export function subscribeToFamily(familyId, onUpdate, onError) {
  const familyRef = doc(db, 'families', familyId);
  return onSnapshot(familyRef, async snapshot => {
    if (!snapshot.exists()) {
      // Seed default data for new family
      const initial = getDefaultFamilyData();
      await setDoc(familyRef, initial);
      onUpdate(initial);
    } else {
      const data = snapshot.data();
      const today = getTodayDateString();

      // Automatic daily reset: if the app is opened on a new calendar date, auto-reset chores to pending!
      if (data.lastActiveDate && data.lastActiveDate !== today) {
        console.log(`[New Day] Detected transition from ${data.lastActiveDate} to ${today}. Auto-resetting daily chores...`);
        try {
          (data.children || []).forEach(child => {
            (child.tasks || []).forEach(task => {
              task.completed = false;
              task.completedAt = null;
            });
          });
          data.lastActiveDate = today;
          if (data.homeAssistant) data.homeAssistant.parentBypass = false;
          
          await updateDoc(familyRef, {
            children: data.children,
            lastActiveDate: today,
            'homeAssistant.parentBypass': false
          });
        } catch (e) {
          console.warn('[AutoReset] Automatic day reset notice:', e.message);
        }
      }

      onUpdate(data);
    }
  }, error => {
    console.error('[Firestore Error] subscribeToFamily:', error);
    if (onError) onError(error);
  });
}

// Toggle Task with One-Way kid enforcement
export async function toggleTask(familyId, childId, taskId, isParent = false) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const child = (data.children || []).find(c => c.id === childId);
  if (!child) throw new Error('Child not found');

  const task = (child.tasks || []).find(t => t.id === taskId);
  if (!task) throw new Error('Task not found');

  // One-way rule: kid cannot uncheck a completed task
  if (!isParent && task.completed) {
    const err = new Error('נעול! רק הורים יכולים לבטל סימון של משימה שהושלמה');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }

  const newCompleted = !task.completed;
  task.completed = newCompleted;
  task.completedAt = newCompleted ? new Date().toISOString() : null;

  await updateDoc(familyRef, {
    children: data.children
  });

  // Log to daily history subcollection
  await logHistoryEvent(familyId, {
    timestamp: new Date().toISOString(),
    childId,
    childName: child.name,
    taskId,
    taskTitle: task.title,
    icon: task.icon,
    action: newCompleted ? 'completed' : 'reverted',
    by: isParent ? 'parent' : 'kid'
  });

  return { child, task };
}

// Log history event
export async function logHistoryEvent(familyId, event) {
  try {
    const today = getTodayDateString();
    const historyDocRef = doc(db, 'families', familyId, 'history', today);
    const snap = await getDoc(historyDocRef);
    let logs = [];
    if (snap.exists()) {
      logs = snap.data().logs || [];
    }
    logs.push(event);
    await setDoc(historyDocRef, {
      date: today,
      logs: logs,
      lastUpdated: serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error('[History] Failed to log event:', e);
  }
}

// Subscribe to Daily History
export function subscribeToDailyHistory(familyId, dateString, onUpdate, onError) {
  const historyRef = doc(db, 'families', familyId, 'history', dateString);
  return onSnapshot(historyRef, snapshot => {
    if (snapshot.exists()) {
      onUpdate(snapshot.data().logs || []);
    } else {
      onUpdate([]);
    }
  }, onError);
}

// Child CRUD
export async function addChild(familyId, name) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const newChild = {
    id: `child_${Date.now()}`,
    name: name.trim(),
    tasks: [
      { id: `t_${Date.now()}_1`, title: 'צחצוח שיניים', completed: false, completedAt: null, icon: 'toothbrush' },
      { id: `t_${Date.now()}_2`, title: 'התלבשות לבד', completed: false, completedAt: null, icon: 'clothes' }
    ]
  };

  const children = [...(data.children || []), newChild];
  await updateDoc(familyRef, { children });
  return newChild;
}

export async function updateChild(familyId, childId, name) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const child = (data.children || []).find(c => c.id === childId);
  if (!child) throw new Error('Child not found');

  child.name = name.trim();
  await updateDoc(familyRef, { children: data.children });
}

export async function deleteChild(familyId, childId) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const children = (data.children || []).filter(c => c.id !== childId);
  await updateDoc(familyRef, { children });
}

// Task CRUD
export async function addTask(familyId, childId, title, icon) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const child = (data.children || []).find(c => c.id === childId);
  if (!child) throw new Error('Child not found');

  const chosenIcon = icon || guessIconFromTitle(title);
  const newTask = {
    id: `t_${Date.now()}`,
    title: title.trim(),
    completed: false,
    completedAt: null,
    icon: chosenIcon
  };

  child.tasks = child.tasks || [];
  child.tasks.push(newTask);
  await updateDoc(familyRef, { children: data.children });
  return newTask;
}

export async function updateTask(familyId, childId, taskId, title, icon) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const child = (data.children || []).find(c => c.id === childId);
  if (!child) throw new Error('Child not found');

  const task = (child.tasks || []).find(t => t.id === taskId);
  if (!task) throw new Error('Task not found');

  if (title) task.title = title.trim();
  if (icon) task.icon = icon;
  await updateDoc(familyRef, { children: data.children });
}

export async function deleteTask(familyId, childId, taskId) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const child = (data.children || []).find(c => c.id === childId);
  if (!child) throw new Error('Child not found');

  child.tasks = (child.tasks || []).filter(t => t.id !== taskId);
  await updateDoc(familyRef, { children: data.children });
}

// Daily Reset
export async function resetDailyTasks(familyId) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  (data.children || []).forEach(child => {
    (child.tasks || []).forEach(task => {
      task.completed = false;
      task.completedAt = null;
    });
  });

  await updateDoc(familyRef, {
    children: data.children,
    lastActiveDate: getTodayDateString(),
    'homeAssistant.parentBypass': false
  });
}

// Parent Bypass
export async function setParentBypass(familyId, enabled) {
  const familyRef = doc(db, 'families', familyId);
  await updateDoc(familyRef, {
    'homeAssistant.parentBypass': Boolean(enabled)
  });
}

// Save Home Assistant Config
export async function saveHomeAssistantConfig(familyId, config) {
  const familyRef = doc(db, 'families', familyId);
  await updateDoc(familyRef, {
    homeAssistant: config
  });
}

// ==========================================
// Home Assistant (Hass.io) Integration Helpers
// ==========================================

export function getCleanHassUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

export function getHassHeaders(token) {
  return {
    'Authorization': `Bearer ${(token || '').trim()}`,
    'Content-Type': 'application/json'
  };
}

// Test connectivity and fetch entity state
export async function testHassConnection(url, token, entityId) {
  const cleanUrl = getCleanHassUrl(url);
  if (!cleanUrl || !token) {
    return { ok: false, message: 'כתובת שרת וטוקן הינם שדות חובה' };
  }

  try {
    const apiRes = await fetch(`${cleanUrl}/api/`, {
      headers: getHassHeaders(token),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
    });

    if (!apiRes.ok) {
      if (apiRes.status === 401) {
        return { ok: false, message: 'שגיאת אימות: הטוקן (Token) אינו תקין או שפג תוקפו' };
      }
      return { ok: false, message: `השרת החזיר קוד שגיאה: ${apiRes.status}` };
    }

    let entityState = null;
    if (entityId && entityId.trim()) {
      try {
        const entityRes = await fetch(`${cleanUrl}/api/states/${entityId.trim()}`, {
          headers: getHassHeaders(token),
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
        });
        if (entityRes.ok) {
          entityState = await entityRes.json();
        } else {
          return {
            ok: true,
            warning: `חיבור ל-Home Assistant הצליח, אך הישות "${entityId}" לא נמצאה (קוד ${entityRes.status}). בדוק את מזהה הישות.`,
            entityState: null
          };
        }
      } catch (err) {
        return {
          ok: true,
          warning: `חיבור הצליח, אך שגיאה בבדיקת ישות "${entityId}": ${err.message}`,
          entityState: null
        };
      }
    }

    return {
      ok: true,
      message: 'החיבור ל-Home Assistant הצליח באופן מושלם! 🎉',
      entityState
    };
  } catch (err) {
    let extra = '';
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && cleanUrl.startsWith('http:')) {
      extra = ' (שים לב: הדפדפן חוסם קריאות HTTP מאתר HTTPS כ-Mixed Content. מומלץ להשתמש בכתובת Nabu Casa HTTPS או להשתמש בהעתקת קוד ה-YAML ישירות ל-Home Assistant)';
    }
    return { ok: false, message: `לא ניתן להתחבר לשרת Home Assistant: ${err.message}${extra}` };
  }
}

// Automatically create and sync all entities in Home Assistant
export async function createAndSyncAllHassEntities(data) {
  const hass = data?.homeAssistant;
  if (!hass || !hass.enabled || !hass.url || !hass.token) {
    return { ok: false, message: 'Home Assistant אינו מופעל או שחסרה כתובת/טוקן', entities: [] };
  }

  const cleanUrl = getCleanHassUrl(hass.url);
  const status = calculateCompletionStatus(data);
  const createdEntities = [];
  const parentBypass = Boolean(hass.parentBypass);

  const allowTv = (hass.targetScope === 'any' ? status.completedTasks > 0 : status.allCompleted) || parentBypass;

  async function postEntity(entityId, state, attributes) {
    try {
      const res = await fetch(`${cleanUrl}/api/states/${entityId}`, {
        method: 'POST',
        headers: getHassHeaders(hass.token),
        body: JSON.stringify({ state: String(state), attributes }),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
      });
      if (res.ok) {
        createdEntities.push({
          entity_id: entityId,
          state: String(state),
          friendly_name: attributes.friendly_name || entityId
        });
      }

      // If entity is an input_boolean, also call the service so Home Assistant native helper syncs
      if (entityId.startsWith('input_boolean.')) {
        try {
          await fetch(`${cleanUrl}/api/services/input_boolean/${state === 'on' ? 'turn_on' : 'turn_off'}`, {
            method: 'POST',
            headers: getHassHeaders(hass.token),
            body: JSON.stringify({ entity_id: entityId }),
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
          });
        } catch (e) {}
      }
    } catch (err) {
      console.warn(`[Home Assistant] Failed to post entity ${entityId}:`, err.message);
    }
  }

  const postPromises = [
    // 1. Primary TV Permission Entity: binary_sensor.kids_tasks_allow_tv
    postEntity('binary_sensor.kids_tasks_allow_tv', allowTv ? 'on' : 'off', {
      friendly_name: `אישור צפייה בטלוויזיה (${data.name || 'Kids Tasker'})`,
      device_class: 'power',
      icon: allowTv ? 'mdi:television' : 'mdi:television-off',
      all_completed: status.allCompleted,
      parent_bypass: parentBypass,
      remaining_tasks: status.remainingTasks,
      total_tasks: status.totalTasks,
      completed_tasks: status.completedTasks,
      percentage: status.percentage,
      last_updated: new Date().toISOString()
    }),

    // 2. Input Boolean helper equivalent: input_boolean.kids_tasks_allow_tv
    postEntity('input_boolean.kids_tasks_allow_tv', allowTv ? 'on' : 'off', {
      friendly_name: 'מתג אישור טלוויזיה - משימות ילדים',
      icon: allowTv ? 'mdi:television-check' : 'mdi:television-stop',
      all_completed: status.allCompleted,
      parent_bypass: parentBypass,
      last_updated: new Date().toISOString()
    }),

    // 2b. Parent Bypass switch helper in Home Assistant: input_boolean.kids_tasks_parent_bypass
    postEntity('input_boolean.kids_tasks_parent_bypass', parentBypass ? 'on' : 'off', {
      friendly_name: 'מעקף הורים - אישור צפייה בטלוויזיה',
      icon: parentBypass ? 'mdi:lock-open-variant' : 'mdi:lock',
      description: 'כאשר מופעל, הטלוויזיה מותרת לצפייה גם אם המשימות טרם הושלמו',
      last_updated: new Date().toISOString()
    }),

    // 3. Overall completion binary sensor: binary_sensor.kids_tasks_completed
    postEntity('binary_sensor.kids_tasks_completed', status.allCompleted ? 'on' : 'off', {
      friendly_name: 'משימות ילדים - כל המשימות הושלמו',
      icon: status.allCompleted ? 'mdi:check-circle-outline' : 'mdi:clock-alert-outline',
      all_completed: status.allCompleted,
      total_tasks: status.totalTasks,
      completed_tasks: status.completedTasks,
      remaining_tasks: status.remainingTasks,
      percentage: status.percentage,
      last_updated: new Date().toISOString()
    }),

    // 4. Remaining tasks sensor: sensor.kids_tasks_remaining
    postEntity('sensor.kids_tasks_remaining', status.remainingTasks, {
      friendly_name: 'משימות ילדים שנותרו',
      unit_of_measurement: 'משימות',
      icon: 'mdi:format-list-checks',
      state_class: 'measurement'
    }),

    // 5. Completion percentage sensor: sensor.kids_tasks_percentage
    postEntity('sensor.kids_tasks_percentage', status.percentage, {
      friendly_name: 'אחוז ביצוע משימות ילדים',
      unit_of_measurement: '%',
      icon: 'mdi:percent',
      state_class: 'measurement'
    })
  ];

  // 6. Child entities
  for (const child of (data.children || [])) {
    const total = (child.tasks || []).length;
    const done = (child.tasks || []).filter(t => t.completed).length;
    const isChildDone = total > 0 && done === total;
    const childEntityId = `binary_sensor.kids_tasks_${child.id}_completed`;
    const childRemainingId = `sensor.kids_tasks_${child.id}_remaining`;

    postPromises.push(
      postEntity(childEntityId, isChildDone ? 'on' : 'off', {
        friendly_name: `משימות ${child.name} - הושלמו`,
        icon: isChildDone ? 'mdi:account-check' : 'mdi:account-clock',
        child_id: child.id,
        child_name: child.name,
        completed_tasks: done,
        total_tasks: total,
        remaining_tasks: total - done
      }),
      postEntity(childRemainingId, total - done, {
        friendly_name: `משימות שנותרו ל${child.name}`,
        unit_of_measurement: 'משימות',
        icon: 'mdi:checkbox-marked-circle-outline',
        child_name: child.name
      })
    );
  }

  await Promise.all(postPromises);

  // 7. Active TV Block Enforcement
  if (hass.autoBlockTv && hass.tvEntityId) {
    try {
      const entityId = hass.tvEntityId.trim();
      const stateRes = await fetch(`${cleanUrl}/api/states/${entityId}`, {
        headers: getHassHeaders(hass.token),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
      });

      if (stateRes.ok) {
        const entityData = await stateRes.json();
        const currentState = (entityData.state || '').toLowerCase();
        const isTvOn = currentState === 'on' || currentState === 'playing' || currentState === 'paused';

        if (!allowTv && isTvOn) {
          console.log(`[Home Assistant] BLOCKING TV (${entityId}): Chores incomplete & bypass off. Turning OFF TV...`);
          await fetch(`${cleanUrl}/api/services/homeassistant/turn_off`, {
            method: 'POST',
            headers: getHassHeaders(hass.token),
            body: JSON.stringify({ entity_id: entityId }),
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
          });
        }
      }
    } catch (err) {
      console.warn(`[Home Assistant] Failed to enforce TV block on ${hass.tvEntityId}:`, err.message);
    }
  }

  return {
    ok: true,
    count: createdEntities.length,
    entities: createdEntities,
    message: `נוצרו ועודכנו ${createdEntities.length} ישויות ב-Home Assistant בהצלחה! 🎉`
  };
}

// Generate Lovelace Card Configuration Object
export function generateLovelaceCardConfig(data, origin = '', familyId = '') {
  const entities = [
    {
      entity: 'binary_sensor.kids_tasks_allow_tv',
      name: 'אישור צפייה בטלוויזיה',
      icon: 'mdi:television'
    },
    {
      entity: 'input_boolean.kids_tasks_allow_tv',
      name: 'מתג אישור טלוויזיה'
    },
    {
      entity: 'input_boolean.kids_tasks_parent_bypass',
      name: 'מעקף הורים (פתיחת טלוויזיה)',
      icon: 'mdi:lock-open-variant'
    },
    {
      entity: 'binary_sensor.kids_tasks_completed',
      name: 'כל המשימות הושלמו'
    },
    {
      entity: 'sensor.kids_tasks_remaining',
      name: 'סה"כ משימות שנותרו לביצוע',
      icon: 'mdi:format-list-checks'
    },
    {
      entity: 'sensor.kids_tasks_percentage',
      name: 'אחוז ביצוע משימות כולל',
      icon: 'mdi:percent'
    }
  ];

  if (data && data.children && data.children.length > 0) {
    entities.push({
      type: 'section',
      label: '👦 פירוט לפי ילדים'
    });

    for (const child of data.children) {
      entities.push({
        entity: `binary_sensor.kids_tasks_${child.id}_completed`,
        name: `משימות ${child.name}`
      });
      entities.push({
        entity: `sensor.kids_tasks_${child.id}_remaining`,
        name: `משימות שנותרו ל${child.name}`
      });
    }
  }

  if (data && data.homeAssistant && data.homeAssistant.tvEntityId) {
    entities.push({
      type: 'section',
      label: '📺 מכשיר טלוויזיה'
    });
    entities.push({
      entity: data.homeAssistant.tvEntityId.trim(),
      name: 'שקע / מסך טלוויזיה'
    });
  }

  const appUrl = origin ? (familyId ? `${origin}/index.html?family=${encodeURIComponent(familyId)}` : origin) : 'https://kids-tasker-c0ef6.web.app';
  entities.push({
    type: 'divider'
  });
  entities.push({
    type: 'weblink',
    name: '📱 פתח לוח משימות לטאבלט (Kids Tasker)',
    url: appUrl,
    icon: 'mdi:tablet-dashboard'
  });

  return {
    type: 'entities',
    title: `📋 לוח משימות לילדים (${(data && data.name) ? data.name : 'Kids Tasker'})`,
    show_header_toggle: false,
    entities: entities
  };
}

// Generate Lovelace Card YAML for Home Assistant
export function generateLovelaceCardYaml(data, origin = '', familyId = '') {
  const card = generateLovelaceCardConfig(data, origin, familyId);
  let yaml = `type: ${card.type}\n`;
  yaml += `title: "${card.title}"\n`;
  yaml += `show_header_toggle: false\n`;
  yaml += `entities:\n`;

  for (const ent of card.entities) {
    if (ent.type === 'section') {
      yaml += `  - type: section\n`;
      yaml += `    label: "${ent.label}"\n`;
    } else if (ent.type === 'divider') {
      yaml += `  - type: divider\n`;
    } else if (ent.type === 'weblink') {
      yaml += `  - type: weblink\n`;
      yaml += `    name: "${ent.name}"\n`;
      yaml += `    url: "${ent.url}"\n`;
      if (ent.icon) yaml += `    icon: ${ent.icon}\n`;
    } else {
      yaml += `  - entity: ${ent.entity}\n`;
      if (ent.name) yaml += `    name: "${ent.name}"\n`;
      if (ent.icon) yaml += `    icon: ${ent.icon}\n`;
    }
  }
  return yaml;
}

// Connect to Home Assistant via WebSocket to automatically create or append the card to Lovelace
export async function addLovelaceCardToHass(data, origin = '', familyId = '') {
  const hass = data?.homeAssistant;
  if (!hass || !hass.enabled || !hass.url || !hass.token) {
    return { ok: false, message: 'Home Assistant אינו מופעל או שחסרה כתובת/טוקן' };
  }

  // Ensure all entities are created in HA first
  await createAndSyncAllHassEntities(data).catch(() => null);

  const cleanUrl = getCleanHassUrl(hass.url);
  const wsUrl = cleanUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://') + '/api/websocket';
  const cardConfig = generateLovelaceCardConfig(data, origin, familyId);

  return new Promise((resolve) => {
    let ws;
    let timeoutId;
    let messageId = 1;
    const pendingRequests = new Map();
    let isCleanedUp = false;

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      clearTimeout(timeoutId);
      if (ws) {
        try { ws.close(); } catch (e) {}
      }
    };

    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ ok: false, message: 'פסק זמן בהתחברות ל-Home Assistant WebSocket (Timeout)' });
    }, 8000);

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      cleanup();
      return resolve({ ok: false, message: `שגיאה ביצירת חיבור WebSocket: ${err.message}` });
    }

    function sendCommand(cmd) {
      const id = messageId++;
      return new Promise((res, rej) => {
        pendingRequests.set(id, { resolve: res, reject: rej });
        try {
          ws.send(JSON.stringify({ id, ...cmd }));
        } catch (e) {
          rej(e);
        }
      });
    }

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        // 1. Auth challenge
        if (msg.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: hass.token.trim() }));
          return;
        }

        if (msg.type === 'auth_invalid') {
          cleanup();
          return resolve({ ok: false, message: 'שגיאת אימות: טוקן לא תקין או פג תוקף' });
        }

        if (msg.type === 'auth_ok') {
          try {
            // Attempt 1: Read default dashboard config
            const configRes = await sendCommand({ type: 'lovelace/config' });

            if (configRes.success && configRes.result) {
              const lovelaceConfig = configRes.result;
              if (!Array.isArray(lovelaceConfig.views) || lovelaceConfig.views.length === 0) {
                lovelaceConfig.views = [{ title: 'Home', cards: [] }];
              }
              const firstView = lovelaceConfig.views[0];
              if (!Array.isArray(firstView.cards)) {
                firstView.cards = [];
              }

              // Check if kids tasker card already exists
              const existingIdx = firstView.cards.findIndex(c => 
                c && (c.title === cardConfig.title || (typeof c.title === 'string' && c.title.includes('Kids Tasker')))
              );

              if (existingIdx >= 0) {
                firstView.cards[existingIdx] = cardConfig;
              } else {
                firstView.cards.push(cardConfig);
              }

              const saveRes = await sendCommand({
                type: 'lovelace/config/save',
                config: lovelaceConfig
              });

              cleanup();
              if (saveRes.success) {
                return resolve({
                  ok: true,
                  mode: 'main_dashboard',
                  message: 'הכרטיס נוסף בהצלחה לדשבורד הראשי ב-Home Assistant! 🎉',
                  path: '/lovelace'
                });
              } else {
                return resolve({
                  ok: false,
                  message: 'שגיאה בשמירת תצורת הדשבורד: ' + (saveRes.error?.message || 'שגיאה לא ידועה')
                });
              }
            } else {
              // Dedicated dashboard
              await sendCommand({
                type: 'lovelace/dashboards/create',
                url_path: 'kids-tasker',
                title: 'לוח משימות לילדים',
                icon: 'mdi:checkbox-marked-circle-outline',
                show_in_sidebar: true
              }).catch(() => null);

              const saveDedicated = await sendCommand({
                type: 'lovelace/config/save',
                url_path: 'kids-tasker',
                config: {
                  title: 'לוח משימות לילדים',
                  views: [{
                    title: 'משימות',
                    cards: [cardConfig]
                  }]
                }
              });

              cleanup();
              if (saveDedicated.success) {
                return resolve({
                  ok: true,
                  mode: 'dedicated_dashboard',
                  message: 'נוצר דשבורד ייעודי "kids-tasker" בסרגל הצד ב-Home Assistant עם הכרטיס! 🎉',
                  path: '/kids-tasker'
                });
              } else {
                return resolve({
                  ok: false,
                  message: 'לא ניתן לשמור כרטיס בדשבורד ייעודי: ' + (saveDedicated.error?.message || 'שגיאה לא ידועה')
                });
              }
            }
          } catch (err) {
            cleanup();
            return resolve({ ok: false, message: 'שגיאה בביצוע פקודות Lovelace מול Home Assistant: ' + err.message });
          }
        }

        // Handle Command Responses
        if (msg.id && pendingRequests.has(msg.id)) {
          const req = pendingRequests.get(msg.id);
          pendingRequests.delete(msg.id);
          req.resolve(msg);
        }
      } catch (err) {
        cleanup();
        resolve({ ok: false, message: 'שגיאה בעיבוד הודעת Home Assistant: ' + err.message });
      }
    };

    ws.onerror = (err) => {
      cleanup();
      let extra = '';
      if (typeof window !== 'undefined' && window.location.protocol === 'https:' && cleanUrl.startsWith('http:')) {
        extra = ' (שים לב: הדפדפן אינו מאפשר חיבור ws בלתי-מוצפן מתוך דף https. אנא השתמש בכתובת Nabu Casa https:// או העתק את ה-YAML ישירות למערכת)';
      }
      resolve({ ok: false, message: `שגיאת חיבור ל-WebSocket: ${err.message || 'לא ניתן להתחבר לשרת'}${extra}` });
    };
  });
}

// Generate Automation YAML for Home Assistant
export function generateHassAutomationYaml(tvEntityId = 'switch.tv_socket') {
  const entity = (tvEntityId && tvEntityId.trim()) ? tvEntityId.trim() : 'switch.tv_socket';
  return `# אוטומציה: כיבוי מיידי כשהטלוויזיה נדלקת לפני סיום משימות
alias: "Kids Tasks - Block TV If Incomplete"
description: "מכבה את הטלוויזיה אוטומטית אם היא נדלקת לפני סיום כל המשימות היומיות בלוח"
trigger:
  - platform: state
    entity_id: ${entity}
    to: "on"
condition:
  - condition: state
    entity_id: binary_sensor.kids_tasks_allow_tv
    state: "off"
action:
  - service: homeassistant.turn_off
    target:
      entity_id: ${entity}
  - service: persistent_notification.create
    data:
      title: "📺 הטלוויזיה נחסמה"
      message: "הטלוויזיה כובתה אוטומטית כי המשימות היומיות בלוח טרם הושלמו!"
mode: single
`;
}

// Generate Webhook YAML configuration for Home Assistant rest_command
export function generateHassWebhookYaml(familyId = 'my-family') {
  const cleanId = (familyId && familyId.trim()) ? familyId.trim() : 'my-family';
  const webhookUrl = 'https://us-central1-kids-tasker-c0ef6.cloudfunctions.net/hassBypassWebhook';
  return `# הגדרה ב-configuration.yaml לשליטה במעקף הורים ישירות מתוך Home Assistant:
rest_command:
  kids_tasker_bypass_on:
    url: "${webhookUrl}"
    method: POST
    headers:
      content-type: "application/json"
    payload: '{"familyId": "${cleanId}", "enabled": true}'

  kids_tasker_bypass_off:
    url: "${webhookUrl}"
    method: POST
    headers:
      content-type: "application/json"
    payload: '{"familyId": "${cleanId}", "enabled": false}'
`;
}

// Update Family Name
export async function updateFamilyName(familyId, newName) {
  const cleanName = (newName || '').trim();
  if (!cleanName) throw new Error('שם המשפחה אינו יכול להיות ריק');
  const familyRef = doc(db, 'families', familyId);
  await updateDoc(familyRef, {
    name: cleanName
  });
  return cleanName;
}

// ==========================================
// User Profile & Onboarding Operations
// ==========================================

// Get user profile from /users/{uid}
export async function getUserProfile(uid) {
  try {
    const userDocRef = doc(db, 'users', uid);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (e) {
    console.error('[UserProfile] Failed to fetch profile:', e);
    return null;
  }
}

// Create a new family and link to user profile
export async function createFamilyForUser(uid, userMeta, familyName, childrenNames = []) {
  // Generate a clean, readable family ID, e.g. fam-k8s9p2
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const cleanPrefix = (familyName || 'family')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 10);
  const familyId = `fam_${cleanPrefix ? cleanPrefix + '_' : ''}${randomSuffix}`;

  const starterTasks = [
    { id: "t1", title: "צחצוח שיניים", completed: false, completedAt: null, icon: "toothbrush" },
    { id: "t2", title: "התלבשות לבד", completed: false, completedAt: null, icon: "clothes" },
    { id: "t3", title: "סידור תיק", completed: false, completedAt: null, icon: "backpack" }
  ];

  const validChildren = (childrenNames.length > 0 ? childrenNames : ['ילד 1']).map((name, idx) => ({
    id: `child_${Date.now()}_${idx + 1}`,
    name: name.trim() || `ילד ${idx + 1}`,
    tasks: JSON.parse(JSON.stringify(starterTasks))
  }));

  const familyData = {
    id: familyId,
    name: familyName ? familyName.trim() : 'המשפחה שלנו',
    ownerUid: uid,
    admins: [uid],
    parents: [uid],
    members: [
      {
        uid: uid,
        email: userMeta.email || '',
        displayName: userMeta.displayName || '',
        photoURL: userMeta.photoURL || '',
        role: 'admin',
        joinedAt: new Date().toISOString()
      }
    ],
    pendingMembers: [],
    tabletToken: generateTabletToken(),
    tablets: [],
    pendingTablets: [],
    createdAt: new Date().toISOString(),
    lastActiveDate: getTodayDateString(),
    children: validChildren,
    homeAssistant: {
      enabled: false,
      url: 'http://homeassistant.local:8123',
      token: '',
      tvEntityId: 'switch.tv_socket',
      autoBlockTv: true,
      pollIntervalSeconds: 30,
      targetScope: 'all',
      parentBypass: false
    }
  };

  // 1. Create family document
  const familyRef = doc(db, 'families', familyId);
  await setDoc(familyRef, familyData);

  // 2. Link familyId in user profile
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, {
    uid: uid,
    email: userMeta.email || '',
    displayName: userMeta.displayName || '',
    photoURL: userMeta.photoURL || '',
    familyId: familyId,
    role: 'admin',
    status: 'approved',
    updatedAt: serverTimestamp()
  }, { merge: true });

  return { familyId, familyData };
}

// Auto-claim unowned/legacy family for current logged in user
export async function claimFamilyIfUnowned(familyId, user) {
  if (!user || !user.uid || !familyId) return false;
  try {
    const cleanId = familyId.trim();
    const familyRef = doc(db, 'families', cleanId);
    const snap = await getDoc(familyRef);
    if (!snap.exists()) return false;
    const data = snap.data();
    if (!data.ownerUid && (!data.admins || data.admins.length === 0)) {
      const adminMember = {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        role: 'admin',
        joinedAt: new Date().toISOString()
      };
      await updateDoc(familyRef, {
        ownerUid: user.uid,
        admins: [user.uid],
        parents: [user.uid],
        members: [adminMember],
        tabletToken: data.tabletToken || generateTabletToken(),
        tablets: data.tablets || [],
        pendingTablets: data.pendingTablets || []
      });
      // Update user profile to approved admin
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        familyId: cleanId,
        role: 'admin',
        status: 'approved',
        updatedAt: serverTimestamp()
      }, { merge: true });
      return true;
    }
  } catch (e) {
    console.warn('[ClaimFamily] Notice:', e.message);
  }
  return false;
}

// Get or create a long-lived tablet pairing token for a family
export async function getOrCreateTabletToken(familyId) {
  const cleanId = (familyId || '').trim();
  const familyRef = doc(db, 'families', cleanId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('משפחה לא נמצאה');

  const data = snap.data();
  if (data.tabletToken) {
    return data.tabletToken;
  }

  const newToken = generateTabletToken();
  await updateDoc(familyRef, { tabletToken: newToken });
  return newToken;
}

// Regenerate tablet token (revokes previous tablet pairings)
export async function regenerateTabletToken(familyId) {
  const cleanId = (familyId || '').trim();
  const familyRef = doc(db, 'families', cleanId);
  const newToken = generateTabletToken();
  await updateDoc(familyRef, { tabletToken: newToken });
  return newToken;
}

// Real-time listener for user profile
export function subscribeToUserProfile(uid, callback) {
  const userRef = doc(db, 'users', uid);
  return onSnapshot(userRef, snap => {
    if (snap.exists()) {
      callback(snap.data());
    } else {
      callback(null);
    }
  }, err => {
    console.error('[UserProfile] Subscription error:', err);
  });
}

// Request to join an existing family with code (Requires Admin Approval)
export async function requestJoinFamily(uid, userMeta, familyId) {
  const cleanId = familyId.trim();
  const familyRef = doc(db, 'families', cleanId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) {
    throw new Error(`קוד משפחה "${cleanId}" לא נמצא. בדוק את הקוד ונסה שוב.`);
  }

  const data = snap.data();
  const pending = data.pendingMembers || [];
  const members = data.members || [];

  // Check if already approved
  if (members.some(m => m.uid === uid)) {
    // Already a member
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, {
      familyId: cleanId,
      status: 'approved'
    }, { merge: true });
    return { status: 'already_approved', familyData: data };
  }

  // Add to pendingMembers if not already there
  const existingIdx = pending.findIndex(p => p.uid === uid);
  const candidate = {
    uid: uid,
    email: userMeta.email || '',
    displayName: userMeta.displayName || '',
    photoURL: userMeta.photoURL || '',
    requestedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    pending[existingIdx] = candidate;
  } else {
    pending.push(candidate);
  }

  await updateDoc(familyRef, { pendingMembers: pending });

  // Update user profile to pending state
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, {
    uid: uid,
    email: userMeta.email || '',
    displayName: userMeta.displayName || '',
    photoURL: userMeta.photoURL || '',
    pendingFamilyId: cleanId,
    status: 'pending',
    updatedAt: serverTimestamp()
  }, { merge: true });

  return { status: 'pending', familyName: data.name || cleanId };
}

// Cancel a pending join request
export async function cancelJoinRequest(uid, familyId) {
  try {
    const familyRef = doc(db, 'families', familyId);
    const snap = await getDoc(familyRef);
    if (snap.exists()) {
      const data = snap.data();
      const pending = (data.pendingMembers || []).filter(p => p.uid !== uid);
      await updateDoc(familyRef, { pendingMembers: pending });
    }
  } catch (e) {
    console.warn('[CancelJoin] Family update notice:', e.message);
  }

  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, {
    pendingFamilyId: null,
    status: null,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Admin: Approve a pending member
export async function approveMember(familyId, targetUid, role = 'parent') {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const pending = data.pendingMembers || [];
  const candidate = pending.find(p => p.uid === targetUid);

  const updatedPending = pending.filter(p => p.uid !== targetUid);
  const members = data.members || [];
  const parents = data.parents || [];
  const admins = data.admins || [];

  const newMember = {
    uid: targetUid,
    email: candidate ? candidate.email : '',
    displayName: candidate ? candidate.displayName : '',
    photoURL: candidate ? candidate.photoURL : '',
    role: role, // 'parent' or 'admin'
    joinedAt: new Date().toISOString()
  };

  // Remove previous entry if exists
  const existingMemberIdx = members.findIndex(m => m.uid === targetUid);
  if (existingMemberIdx >= 0) {
    members[existingMemberIdx] = newMember;
  } else {
    members.push(newMember);
  }

  if (!parents.includes(targetUid)) parents.push(targetUid);
  if (role === 'admin' && !admins.includes(targetUid)) admins.push(targetUid);

  await updateDoc(familyRef, {
    pendingMembers: updatedPending,
    members: members,
    parents: parents,
    admins: admins
  });

  // Activate user profile
  const userRef = doc(db, 'users', targetUid);
  await setDoc(userRef, {
    familyId: familyId,
    pendingFamilyId: null,
    role: role,
    status: 'approved',
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Admin: Reject a pending member
export async function rejectMember(familyId, targetUid) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (snap.exists()) {
    const data = snap.data();
    const updatedPending = (data.pendingMembers || []).filter(p => p.uid !== targetUid);
    await updateDoc(familyRef, { pendingMembers: updatedPending });
  }

  // Update rejected user profile
  const userRef = doc(db, 'users', targetUid);
  await setDoc(userRef, {
    pendingFamilyId: null,
    status: 'rejected',
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Admin: Update an existing member's role (parent <-> admin)
export async function updateMemberRole(familyId, targetUid, newRole) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const members = data.members || [];
  const member = members.find(m => m.uid === targetUid);
  if (!member) throw new Error('Member not found');

  // Prevent demoting original owner
  if (data.ownerUid === targetUid && newRole !== 'admin') {
    throw new Error('לא ניתן לבטל הרשאת מנהל למקים המשפחה הראשי');
  }

  member.role = newRole;
  let admins = data.admins || [];
  if (newRole === 'admin') {
    if (!admins.includes(targetUid)) admins.push(targetUid);
  } else {
    admins = admins.filter(id => id !== targetUid);
  }

  await updateDoc(familyRef, {
    members: members,
    admins: admins
  });

  const userRef = doc(db, 'users', targetUid);
  await setDoc(userRef, {
    role: newRole,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Admin: Remove a member from the family
export async function removeMember(familyId, targetUid) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  if (data.ownerUid === targetUid) {
    throw new Error('לא ניתן להסיר את מקים המשפחה הראשי');
  }

  const members = (data.members || []).filter(m => m.uid !== targetUid);
  const parents = (data.parents || []).filter(id => id !== targetUid);
  const admins = (data.admins || []).filter(id => id !== targetUid);

  await updateDoc(familyRef, {
    members: members,
    parents: parents,
    admins: admins
  });

  const userRef = doc(db, 'users', targetUid);
  await setDoc(userRef, {
    familyId: null,
    status: null,
    role: null,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// Tablet: Register or refresh a tablet connection request
export async function registerTabletRequest(familyId, tabletInfo) {
  const cleanId = (familyId || '').trim();
  console.log(`[Tablet Registration] Registering tablet ${tabletInfo.id} for family "${cleanId}"...`);
  const familyRef = doc(db, 'families', cleanId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) {
    console.error(`[Tablet Registration] Family "${cleanId}" not found in Firestore!`);
    throw new Error('Family not found');
  }

  const data = snap.data();
  const tablets = data.tablets || [];
  const pendingTablets = data.pendingTablets || [];

  // If tablet is already approved
  if (tablets.some(t => t.id === tabletInfo.id)) {
    console.log(`[Tablet Registration] Device ${tabletInfo.id} is already in approved tablets list.`);
    return { status: 'already_approved' };
  }

  // If already pending, update requestedAt / token
  const existingPendingIndex = pendingTablets.findIndex(t => t.id === tabletInfo.id);
  if (existingPendingIndex !== -1) {
    pendingTablets[existingPendingIndex] = {
      ...pendingTablets[existingPendingIndex],
      token: tabletInfo.token || pendingTablets[existingPendingIndex].token || null,
      requestedAt: new Date().toISOString()
    };
    await updateDoc(familyRef, { pendingTablets });
    console.log(`[Tablet Registration] Updated existing pending request for ${tabletInfo.id}.`);
    return { status: 'already_pending' };
  }

  // Otherwise append to pendingTablets
  pendingTablets.push({
    id: tabletInfo.id,
    name: tabletInfo.name || 'טאבלט חדש',
    token: tabletInfo.token || null,
    requestedAt: new Date().toISOString(),
    userAgent: tabletInfo.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  });

  await updateDoc(familyRef, { pendingTablets });
  console.log(`[Tablet Registration] Successfully added ${tabletInfo.id} to pendingTablets in family "${cleanId}".`);
  return { status: 'requested' };
}

// Admin: Approve a pending tablet and move to active tablets
export async function approveTablet(familyId, tabletId, customName = null) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const pendingTablets = data.pendingTablets || [];
  const tablets = data.tablets || [];

  const pendingItem = pendingTablets.find(t => t.id === tabletId);
  const updatedPending = pendingTablets.filter(t => t.id !== tabletId);

  const updatedTablets = tablets.filter(t => t.id !== tabletId);
  updatedTablets.push({
    id: tabletId,
    name: (customName && customName.trim()) ? customName.trim() : (pendingItem && pendingItem.name ? pendingItem.name : 'טאבלט סלון'),
    token: pendingItem ? pendingItem.token : null,
    approvedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  });

  await updateDoc(familyRef, {
    tablets: updatedTablets,
    pendingTablets: updatedPending
  });
}

// Admin: Reject a pending tablet request
export async function rejectTablet(familyId, tabletId) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const updatedPending = (data.pendingTablets || []).filter(t => t.id !== tabletId);
  await updateDoc(familyRef, { pendingTablets: updatedPending });
}

// Admin: Remove an approved tablet (causes immediate real-time disconnection)
export async function removeTablet(familyId, tabletId) {
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const updatedTablets = (data.tablets || []).filter(t => t.id !== tabletId);
  await updateDoc(familyRef, { tablets: updatedTablets });
}

// Admin: Update display name of an approved tablet
export async function updateTabletName(familyId, tabletId, newName) {
  if (!newName || !newName.trim()) return;
  const familyRef = doc(db, 'families', familyId);
  const snap = await getDoc(familyRef);
  if (!snap.exists()) throw new Error('Family not found');

  const data = snap.data();
  const tablets = (data.tablets || []).map(t => {
    if (t.id === tabletId) {
      return { ...t, name: newName.trim() };
    }
    return t;
  });

  await updateDoc(familyRef, { tablets });
}

// Admin: Revoke all tablets and reset tablet token (removes all tablets from previous allowed method)
export async function revokeAllTablets(familyId) {
  const cleanId = (familyId || '').trim();
  const familyRef = doc(db, 'families', cleanId);
  const newToken = generateTabletToken();
  await updateDoc(familyRef, {
    tabletToken: newToken,
    tablets: [],
    pendingTablets: []
  });
  return newToken;
}


