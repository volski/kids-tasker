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

// Default initial data template for new families
export function getDefaultFamilyData(familyName = 'משפחתנו') {
  return {
    name: familyName,
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
        members: [adminMember]
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
