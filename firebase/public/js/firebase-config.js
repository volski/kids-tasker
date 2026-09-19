// Firebase App & Auth Configuration (ES Module)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInAnonymously,
  onAuthStateChanged, 
  signOut as fbSignOut,
  connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { 
  getFirestore, 
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Resolve Firebase configuration
async function resolveFirebaseConfig() {
  if (window.FIREBASE_CONFIG) return window.FIREBASE_CONFIG;

  // 1. Try to load auto-provided configuration from Firebase Hosting
  try {
    const res = await fetch('/__/firebase/init.json');
    if (res.ok) {
      const config = await res.json();
      console.log('[Firebase] Auto-loaded project credentials from Firebase Hosting:', config.projectId);
      return config;
    }
  } catch (e) {
    // Not running on Firebase Hosting or fetch failed
  }

  // 2. Try localStorage custom config
  const saved = localStorage.getItem('kids_tasker_firebase_config');
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }

  // 3. Fallback to placeholder (kids-tasker-c0ef6 defaults)
  return {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "kids-tasker-c0ef6.firebaseapp.com",
    projectId: "kids-tasker-c0ef6",
    storageBucket: "kids-tasker-c0ef6.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  };
}

const firebaseConfig = await resolveFirebaseConfig();

// Check if credentials are missing
export const isConfigured = firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_FIREBASE_API_KEY';

if (!isConfigured) {
  console.warn('[Firebase] Warning: Running with placeholder credentials. Please configure real keys.');
  window.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div');
    banner.className = 'bg-amber-900/90 border-b border-amber-600 text-amber-200 text-xs sm:text-sm p-3 text-center sticky top-0 z-50';
    banner.innerHTML = `⚠️ <b>שים לב:</b> מפתחות Firebase עדיין לא הוגדרו עבור פרויקט <code>${firebaseConfig.projectId}</code>. יש להדביק את המפתחות מ-Firebase Console כדי שהסנכרון יעבוד במהירות.`;
    document.body.prepend(banner);
  });
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Modern Firestore offline cache (replaces deprecated enableIndexedDbPersistence)
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (e) {
  db = getFirestore(app);
}

// Check if running on local emulator
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  if (window.FIREBASE_USE_EMULATOR) {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099');
      connectFirestoreEmulator(db, 'localhost', 8080);
      console.log('[Firebase] Connected to local Firebase Emulators (Auth: 9099, Firestore: 8080)');
    } catch (e) {
      console.warn('[Firebase] Emulator skipped:', e.message);
    }
  }
}

// Active Family ID Session Helper
const FAMILY_KEY = 'kids_tasker_family_id';
const ROLE_KEY = 'kids_tasker_user_role';

export function getStoredFamilyId() {
  return localStorage.getItem(FAMILY_KEY) || 'demo-family';
}

export function setStoredFamilyId(familyId) {
  if (familyId) {
    localStorage.setItem(FAMILY_KEY, familyId);
  } else {
    localStorage.removeItem(FAMILY_KEY);
  }
}

export function getStoredRole() {
  return localStorage.getItem(ROLE_KEY) || 'parent';
}

export function setStoredRole(role) {
  localStorage.setItem(ROLE_KEY, role);
}

// Auth Actions
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  return await signInWithPopup(auth, provider);
}

export async function loginWithEmail(email, password) {
  return await signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithEmail(email, password) {
  return await createUserWithEmailAndPassword(auth, email, password);
}

export async function loginAsTablet(familyId) {
  const res = await signInAnonymously(auth);
  setStoredFamilyId(familyId);
  setStoredRole('tablet');
  return res;
}

export async function logoutUser() {
  return await fbSignOut(auth);
}

export function subscribeToAuth(callback) {
  return onAuthStateChanged(auth, user => {
    callback(user);
  });
}

export { app, auth, db };
