import { Injectable, signal } from '@angular/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  User,
  Auth
} from 'firebase/auth';

// Default / fallback Firebase config structure
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDummyApiKeyForLocalDevAndTesting123",
  authDomain: "kids-tasker.firebaseapp.com",
  projectId: "kids-tasker",
  storageBucket: "kids-tasker.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

@Injectable({
  providedIn: 'root'
})
export class FirebaseAuthService {
  private auth: Auth | null = null;
  public userSignal = signal<User | null>(null);
  public isInitialized = signal<boolean>(false);

  constructor() {
    this.initFirebase();
  }

  private async initFirebase() {
    try {
      let config = (window as any).__ENV__?.FIREBASE_CONFIG;
      if (!config) {
        try {
          const res = await fetch('/api/auth/config');
          const data = await res.json();
          if (data && data.success && data.config) {
            config = data.config;
          }
        } catch (e) {}
      }
      if (!config) config = DEFAULT_FIREBASE_CONFIG;

      const app = getApps().length === 0 ? initializeApp(config) : getApp();
      this.auth = getAuth(app);
      
      onAuthStateChanged(this.auth, (user) => {
        this.userSignal.set(user);
        this.isInitialized.set(true);
      });
    } catch (err) {
      console.warn('[FirebaseAuth] Initialized in local dev mode:', err);
      this.isInitialized.set(true);
    }
  }

  public async loginWithGoogle(): Promise<User | null> {
    if (!this.auth) throw new Error('Firebase Auth not initialized');
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(this.auth, provider);
    return result.user;
  }

  public async loginWithEmail(email: string, pass: string): Promise<User | null> {
    if (!this.auth) throw new Error('Firebase Auth not initialized');
    const result = await signInWithEmailAndPassword(this.auth, email, pass);
    return result.user;
  }

  public async signUpWithEmail(email: string, pass: string): Promise<User | null> {
    if (!this.auth) throw new Error('Firebase Auth not initialized');
    const result = await createUserWithEmailAndPassword(this.auth, email, pass);
    return result.user;
  }

  public async logout(): Promise<void> {
    if (this.auth) {
      await signOut(this.auth);
      this.userSignal.set(null);
    }
  }

  public async getIdToken(forceRefresh = false): Promise<string | null> {
    const user = this.userSignal();
    if (!user) return null;
    try {
      return await user.getIdToken(forceRefresh);
    } catch {
      return null;
    }
  }

  public get currentUser(): User | null {
    return this.userSignal();
  }
}
