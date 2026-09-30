const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_DIR = process.env.DB_DIR || (process.env.TASKS_FILE ? path.dirname(process.env.TASKS_FILE) : path.join(__dirname, 'db'));
const HOUSEHOLDS_DIR = path.join(DB_DIR, 'households');
const DEVICES_FILE = path.join(DB_DIR, 'devices.json');
const PAIRING_FILE = path.join(DB_DIR, 'pairing_sessions.json');
const HOUSEHOLDS_REGISTRY_FILE = path.join(DB_DIR, 'households_registry.json');
const USER_MAPPINGS_FILE = path.join(DB_DIR, 'user_mappings.json');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(HOUSEHOLDS_DIR)) fs.mkdirSync(HOUSEHOLDS_DIR, { recursive: true });

function readJsonFile(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[DB] Failed to read ${filePath}:`, err.message);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    const tempFile = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, filePath);
  } catch (err) {
    console.error(`[DB] Failed to write ${filePath}:`, err.message);
  }
}

// Multi-tenant Household Data Read/Write
function getHouseholdTasksPath(householdId) {
  const safeId = (householdId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(HOUSEHOLDS_DIR, safeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'tasks.json');
}

function readHouseholdTasks(householdId, defaultData) {
  const file = getHouseholdTasksPath(householdId);
  if (!fs.existsSync(file)) {
    // If fallback single-tenant tasks.json exists, copy/migrate it
    const legacyFile = path.join(DB_DIR, 'tasks.json');
    if (fs.existsSync(legacyFile)) {
      const legacyData = readJsonFile(legacyFile, null);
      if (legacyData) {
        writeJsonFile(file, legacyData);
        return legacyData;
      }
    }
    writeJsonFile(file, defaultData);
    return defaultData;
  }
  return readJsonFile(file, defaultData);
}

function writeHouseholdTasks(householdId, data) {
  const file = getHouseholdTasksPath(householdId);
  writeJsonFile(file, data);
}

// Device Registry
function readDevices() {
  return readJsonFile(DEVICES_FILE, {});
}

function writeDevices(devices) {
  writeJsonFile(DEVICES_FILE, devices);
}

function getDeviceByToken(token) {
  if (!token) return null;
  const devices = readDevices();
  for (const [id, dev] of Object.entries(devices)) {
    if (dev.deviceToken === token && dev.status === 'allowed') {
      return dev;
    }
  }
  return null;
}

function getHouseholdDevices(householdId) {
  const devices = readDevices();
  return Object.values(devices).filter(d => d.householdId === householdId && d.status === 'allowed');
}

// Temporary Pairing Sessions (QR Codes)
function readPairingSessions() {
  return readJsonFile(PAIRING_FILE, {});
}

function writePairingSessions(sessions) {
  writeJsonFile(PAIRING_FILE, sessions);
}

function generatePairingCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `KIDS-${num}`;
}

function initPairingSession(ip, userAgent) {
  const sessions = readPairingSessions();
  
  // Clean expired sessions (> 15 mins)
  const now = Date.now();
  for (const [id, sess] of Object.entries(sessions)) {
    if (sess.expiresAt < now) delete sessions[id];
  }

  const sessionId = 'sess_' + crypto.randomBytes(8).toString('hex');
  const deviceId = 'dev_' + crypto.randomBytes(8).toString('hex');
  let code = generatePairingCode();

  // Ensure unique code
  let attempts = 0;
  while (Object.values(sessions).some(s => s.code === code) && attempts < 10) {
    code = generatePairingCode();
    attempts++;
  }

  const newSession = {
    sessionId,
    deviceId,
    code,
    status: 'pending', // 'pending' | 'paired' | 'expired'
    createdAt: now,
    expiresAt: now + (15 * 60 * 1000), // 15 mins
    ip: ip || 'unknown',
    userAgent: userAgent || 'unknown'
  };

  sessions[sessionId] = newSession;
  writePairingSessions(sessions);
  return newSession;
}

function pairDevice(code, householdId, deviceName) {
  const sessions = readPairingSessions();
  const now = Date.now();

  let targetSessId = null;
  let targetSess = null;

  for (const [id, s] of Object.entries(sessions)) {
    if (s.code === (code || '').trim().toUpperCase() && s.expiresAt > now && s.status === 'pending') {
      targetSessId = id;
      targetSess = s;
      break;
    }
  }

  if (!targetSess) {
    throw new Error('קוד חיבור לא תקף או פג תוקף');
  }

  // Generate permanent device token
  const deviceToken = 'dev_tok_' + crypto.randomBytes(16).toString('hex');

  // Register in Devices registry
  const devices = readDevices();
  devices[targetSess.deviceId] = {
    deviceId: targetSess.deviceId,
    householdId,
    deviceName: (deviceName || 'מסך חדש').trim(),
    deviceToken,
    status: 'allowed',
    pairedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    ip: targetSess.ip,
    userAgent: targetSess.userAgent
  };
  writeDevices(devices);

  // Update session
  targetSess.status = 'paired';
  targetSess.deviceToken = deviceToken;
  targetSess.householdId = householdId;
  writePairingSessions(sessions);

  return {
    sessionId: targetSessId,
    deviceId: targetSess.deviceId,
    deviceToken,
    householdId,
    deviceName: devices[targetSess.deviceId].deviceName
  };
}

function revokeDevice(deviceId, householdId) {
  const devices = readDevices();
  const dev = devices[deviceId];

  if (!dev) {
    throw new Error('מכשיר לא נמצא');
  }

  if (dev.householdId !== householdId) {
    throw new Error('אין הרשאה להסרת מכשיר זה');
  }

  dev.status = 'revoked';
  dev.revokedAt = new Date().toISOString();
  writeDevices(devices);

  return dev;
}

// ---- Household Registry & Multi-Parent Mapping ----
function readHouseholdsRegistry() {
  return readJsonFile(HOUSEHOLDS_REGISTRY_FILE, {});
}

function writeHouseholdsRegistry(registry) {
  writeJsonFile(HOUSEHOLDS_REGISTRY_FILE, registry);
}

function readUserMappings() {
  return readJsonFile(USER_MAPPINGS_FILE, {});
}

function writeUserMappings(mappings) {
  writeJsonFile(USER_MAPPINGS_FILE, mappings);
}

function generateFamilyJoinCode() {
  const registry = readHouseholdsRegistry();
  const existingCodes = new Set(Object.values(registry).map(h => (h.joinCode || '').toUpperCase()));
  let code;
  do {
    const num = Math.floor(1000 + Math.random() * 9000);
    code = `FAM-${num}`;
  } while (existingCodes.has(code));
  return code;
}

function getHouseholdIdForUser(uid, email = '') {
  if (!uid) return 'house_default';
  const mappings = readUserMappings();
  if (mappings[uid] && mappings[uid].householdId) {
    return mappings[uid].householdId;
  }

  const registry = readHouseholdsRegistry();
  const householdId = registry[uid] ? uid : uid;
  const joinCode = generateFamilyJoinCode();
  const emailPrefix = email ? email.split('@')[0] : 'משפחה';

  if (!registry[householdId]) {
    registry[householdId] = {
      householdId,
      name: `משפחת ${emailPrefix}`,
      joinCode,
      ownerUid: uid,
      createdAt: new Date().toISOString(),
      members: [uid]
    };
    writeHouseholdsRegistry(registry);
  }

  mappings[uid] = {
    uid,
    email: email || '',
    householdId,
    joinedAt: new Date().toISOString()
  };
  writeUserMappings(mappings);

  return householdId;
}

function getHouseholdInfo(householdId) {
  if (!householdId) return null;
  const registry = readHouseholdsRegistry();
  const mappings = readUserMappings();
  const household = registry[householdId];
  if (!household) {
    return null;
  }
  const memberProfiles = (household.members || []).map(mUid => {
    const map = mappings[mUid] || {};
    return {
      uid: mUid,
      email: map.email || '',
      name: map.name || (map.email ? map.email.split('@')[0] : mUid)
    };
  });

  return {
    householdId: household.householdId,
    name: household.name || 'המשפחה שלי',
    joinCode: household.joinCode,
    ownerUid: household.ownerUid,
    createdAt: household.createdAt,
    members: household.members || [],
    memberProfiles
  };
}

function createHousehold(ownerUid, ownerEmail, familyName) {
  if (!ownerUid) throw new Error('נדרש מזהה משתמש');
  const safeName = (familyName || '').trim() || 'המשפחה שלי';
  const registry = readHouseholdsRegistry();
  const mappings = readUserMappings();

  const householdId = `house_${crypto.randomBytes(6).toString('hex')}`;
  const joinCode = generateFamilyJoinCode();

  registry[householdId] = {
    householdId,
    name: safeName,
    joinCode,
    ownerUid,
    createdAt: new Date().toISOString(),
    members: [ownerUid]
  };
  writeHouseholdsRegistry(registry);

  mappings[ownerUid] = {
    uid: ownerUid,
    email: ownerEmail || '',
    householdId,
    joinedAt: new Date().toISOString()
  };
  writeUserMappings(mappings);

  return getHouseholdInfo(householdId);
}

function joinHouseholdByCode(userUid, userEmail, inputCode) {
  if (!userUid) throw new Error('נדרש מזהה משתמש');
  const code = (inputCode || '').trim().toUpperCase();
  if (!code) throw new Error('נא להזין קוד הצטרפות');

  const registry = readHouseholdsRegistry();
  const mappings = readUserMappings();

  let targetHousehold = null;
  for (const h of Object.values(registry)) {
    if ((h.joinCode || '').toUpperCase() === code) {
      targetHousehold = h;
      break;
    }
  }

  if (!targetHousehold) {
    throw new Error('קוד הצטרפות לא תקין. בדוק את הקוד ונסה שוב.');
  }

  if (!targetHousehold.members.includes(userUid)) {
    targetHousehold.members.push(userUid);
    writeHouseholdsRegistry(registry);
  }

  mappings[userUid] = {
    uid: userUid,
    email: userEmail || '',
    householdId: targetHousehold.householdId,
    joinedAt: new Date().toISOString()
  };
  writeUserMappings(mappings);

  return getHouseholdInfo(targetHousehold.householdId);
}

module.exports = {
  readHouseholdTasks,
  writeHouseholdTasks,
  readDevices,
  writeDevices,
  getDeviceByToken,
  getHouseholdDevices,
  initPairingSession,
  pairDevice,
  revokeDevice,
  readPairingSessions,
  getHouseholdIdForUser,
  getHouseholdInfo,
  createHousehold,
  joinHouseholdByCode
};
