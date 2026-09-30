const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_DIR = process.env.DB_DIR || (process.env.TASKS_FILE ? path.dirname(process.env.TASKS_FILE) : path.join(__dirname, 'db'));
const HOUSEHOLDS_DIR = path.join(DB_DIR, 'households');
const DEVICES_FILE = path.join(DB_DIR, 'devices.json');
const PAIRING_FILE = path.join(DB_DIR, 'pairing_sessions.json');

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
  readPairingSessions
};
