const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { getDeviceByToken } = require('./db_manager');

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function findServiceAccountFile() {
  const possiblePaths = [
    path.join(__dirname, 'serviceAccount.json'),
    path.join(__dirname, 'serviceAccountKey.json'),
    path.join(__dirname, 'db', 'serviceAccount.json'),
    path.join(__dirname, 'db', 'serviceAccountKey.json')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function initFirebase() {
  if (firebaseInitialized) return;
  
  try {
    const serviceAccountFile = findServiceAccountFile();
    if (serviceAccountFile) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountFile, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      firebaseInitialized = true;
      console.log(`[Auth] Firebase Admin initialized via ${path.basename(serviceAccountFile)}`);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : process.env.FIREBASE_SERVICE_ACCOUNT;
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      firebaseInitialized = true;
      console.log('[Auth] Firebase Admin initialized via FIREBASE_SERVICE_ACCOUNT env var');
    } else if (process.env.FIREBASE_PROJECT_ID) {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID
      });
      firebaseInitialized = true;
      console.log(`[Auth] Firebase Admin initialized with projectId: ${process.env.FIREBASE_PROJECT_ID}`);
    } else {
      console.warn('[Auth] No serviceAccount.json or FIREBASE_PROJECT_ID supplied. Token verification operating in mock mode.');
    }
  } catch (err) {
    console.error('[Auth] Failed to initialize Firebase Admin:', err.message);
  }
}

initFirebase();

async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const deviceToken = req.headers['x-device-token'] || req.query.deviceToken;

  // 1. Parent Request via Firebase ID Token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.split('Bearer ')[1].trim();

    // Test bypass token for E2E / local testing
    if (process.env.NODE_ENV === 'test' || idToken.startsWith('test_token_')) {
      const testUid = req.headers['x-test-uid'] || 'house_test';
      req.user = { uid: testUid, email: 'test@parent.com' };
      req.householdId = testUid;
      req.isParent = true;
      return next();
    }

    if (!firebaseInitialized) {
      return res.status(500).json({ error: 'Firebase Admin not configured on server.' });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
      req.householdId = decodedToken.uid;
      req.isParent = true;
      return next();
    } catch (err) {
      console.error('[Auth] Invalid Firebase ID Token:', err.message);
      return res.status(401).json({ error: 'פג תוקף חיבור ההורה. אנא התחבר מחדש.' });
    }
  }

  // 2. Kids Display Request via Device Token
  if (deviceToken) {
    const dev = getDeviceByToken(deviceToken);
    if (dev) {
      req.isDevice = true;
      req.deviceId = dev.deviceId;
      req.householdId = dev.householdId;
      req.isParent = false;
      return next();
    } else {
      return res.status(401).json({ error: 'מכשיר זה אינו מורשה או שחיבורו הוסר.', code: 'DEVICE_REVOKED' });
    }
  }

  // 3. Fallback for test runner if no auth provided in test mode
  if (process.env.NODE_ENV === 'test') {
    const testUid = req.headers['x-test-uid'] || 'house_test';
    req.householdId = testUid;
    req.isParent = true;
    return next();
  }

  return res.status(401).json({ error: 'גישה לא מורשית. נדרש חיבור הורה או מכשיר מורשה.' });
}

function requireParentAuth(req, res, next) {
  if (!req.isParent) {
    return res.status(403).json({ error: 'פעולה זו מורשת להורים בלבד.' });
  }
  next();
}

module.exports = {
  verifyAuth,
  requireParentAuth
};
