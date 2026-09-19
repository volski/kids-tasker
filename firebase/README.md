# Kids Tasker - Firebase Edition (גרסת ענן רב-משפחתית)

A modular, serverless, multi-tenant version of Kids Tasker designed for **Firebase Hosting**, **Cloud Firestore**, and **Cloud Functions**.

---

## 🌟 Features in Firebase Edition

1. **Zero-Server Maintenance**:
   - Hosted completely on Firebase CDN with 99.99% uptime and automatic global SSL.
   - Runs on the **100% Free Spark Tier** for dozens of families without paying for VPS/servers.
2. **Built-in Realtime Synchronization**:
   - Replaces Socket.io with Cloud Firestore `onSnapshot` listeners.
   - Any chore marked on one screen updates all tablets and parent phones instantaneously.
3. **Multi-Tenancy**:
   - Isolated data per family (`/families/{familyId}`).
   - Family switcher and pairing tokens for wall-mounted tablets.
4. **Enforced One-Way Kid Completion**:
   - Enforced both in client UI and in `firestore.rules`.
   - Children can only mark chores as done (`false` &rarr; `true`).
   - Only authenticated parents can uncheck or edit tasks.
5. **Serverless Daily Morning Reset**:
   - Scheduled Cloud Function runs every morning at 04:00 AM (`0 4 * * *`) to reset all families' chores to pending for a fresh morning routine without losing historical logs.
6. **Home Assistant Webhook Bridge**:
   - Cloud Function endpoint to toggle parent bypass (`POST /hassBypassWebhook`) directly from Home Assistant automations.

---

## 📁 Directory Structure

```text
firebase/
├── firebase.json              # Firebase Hosting rewrites, Firestore, and functions config
├── firestore.rules            # Multi-tenant security rules with One-Way kid completion
├── firestore.indexes.json     # Firestore indexes
├── README.md                  # This documentation
│
├── public/                    # Deployed directly to Firebase Hosting CDN
│   ├── index.html             # Tablet Task Board SPA
│   ├── parent.html            # Parent Management Dashboard SPA
│   ├── css/
│   │   └── style.css          # Shared styles, RTL helpers, animations
│   ├── js/
│   │   ├── firebase-config.js # Modular Firebase SDK config & Auth helpers
│   │   ├── db.js              # Firestore service layer (CRUD, realtime sync, history)
│   │   ├── tablet.js          # Modular Tablet UI Controller
│   │   └── parent.js          # Modular Parent Dashboard Controller
│   └── icons/                 # SVG chore icons (15 rich vector icons)
│
└── functions/                 # Cloud Functions (serverless backend)
    ├── package.json
    └── index.js               # Scheduled morning reset & Hass webhook
```

---

## 🚀 Quick Start

### 1. Configure Firebase Credentials
Open `firebase/public/js/firebase-config.js` and replace the placeholder configuration with your project credentials from the [Firebase Console](https://console.firebase.google.com/):

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

### 2. Local Testing (Firebase Emulator Suite)
You can test the entire stack locally without deploying to Google Cloud:

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# From the firebase/ folder:
cd firebase
firebase emulators:start
```
- **Hosting (Kids Board & Parent Dash):** [http://localhost:5000](http://localhost:5000)
- **Emulator UI (View Firestore Data live):** [http://localhost:4000](http://localhost:4000)

### 3. Deploy to Production
```bash
# Login to Firebase
firebase login

# Initialize project (select your project ID)
firebase use --add

# Deploy everything (Hosting, Firestore rules, Functions)
firebase deploy
```

---

## 🔒 Security Rules

The security rules in [`firestore.rules`](./firestore.rules) ensure:
- Only family members can read family data.
- **Children cannot uncheck completed chores:**
  ```javascript
  allow update: if isFamilyParent(familyId) || (
    isFamilyMember(familyId) &&
    resource.data.completed == false &&
    request.resource.data.completed == true
  );
  ```
- Only parents can add/edit/delete children and tasks.
