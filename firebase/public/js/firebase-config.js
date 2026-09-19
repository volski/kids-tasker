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
  connectFirestoreEmulator, 
  enableIndexedDbPersistence 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Default configuration placeholder
// Replace with your project credentials from Firebase Console:
// Project Settings -> General -> Your apps -> Web app
const firebaseConfig = window.FIREBASE_CONFIG || {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Check if running on local emulator
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  // If FIREBASE_USE_EMULATOR is true in window, connect to emulators
  if (window.FIREBASE_USE_EMULATOR) {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099');
      connectFirestoreEmulator(db, 'localhost', 8080);
      console.log('[Firebase] Connected to local Firebase Emulators (Auth: 9099, Firestore: 8080)');
    } catch (e) {
      console.warn('[Firebase] Emulator connection skipped or already initialized:', e.message);
    }
  }
}

// Enable offline persistence for tablet reliability
try {
  enableIndexedDbPersistence(db).catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('[Firestore] Multiple tabs open; offline persistence enabled in first tab only.');
    } else if (err.code === 'unimplemented') {
      console.warn('[Firestore] Browser does not support offline persistence.');
    }
  });
} catch (e) {
  // Persistence already enabled or unsupported
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
  return localStorage.getItem(ROLE_KEY) || 'parent'; // 'parent' or 'tablet'
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
