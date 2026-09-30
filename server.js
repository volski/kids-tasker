require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const {
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
  readHouseholdsRegistry,
  getHouseholdIdForUser,
  getHouseholdInfo,
  createHousehold,
  joinHouseholdByCode,
  leaveHousehold,
  removeMemberFromHousehold,
  renameHousehold,
  transferOwnership
} = require('./db_manager');

const { getAuth } = require('firebase-admin/auth');
const { verifyAuth, requireParentAuth } = require('./auth_middleware');

// WebSocket client support across all Node.js versions (including Node 20 LTS on Proxmox/Debian)
const WebSocket = (() => {
  try {
    return require('ws');
  } catch (e) {
    if (typeof globalThis.WebSocket !== 'undefined') {
      return globalThis.WebSocket;
    }
    return class {
      constructor() {
        throw new Error('WebSocket is not supported in this Node.js environment. Please run "npm install ws".');
      }
    };
  }
})();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const DB_DIR = process.env.DB_DIR || (process.env.TASKS_FILE ? path.dirname(process.env.TASKS_FILE) : path.join(__dirname, 'db'));
const DB_TASKS = path.join(DB_DIR, 'tasks.json');
const DB_HISTORY = path.join(DB_DIR, 'history.json');
const DB_CONFIG = path.join(DB_DIR, 'config.json');
const DB_SETTINGS = path.join(DB_DIR, 'settings.json');
const ICONS_DIR = path.join(__dirname, 'icons');

// Serve icons directory statically
app.use('/icons', express.static(ICONS_DIR));
const SOUNDS_DIR = path.join(__dirname, 'sounds');
if (!fs.existsSync(SOUNDS_DIR)) {
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
app.use('/sounds', express.static(SOUNDS_DIR));

// Server-side TTS (Edge neural voices) with on-disk mp3 cache
const TTS_VOICES = { female: 'he-IL-HilaNeural', male: 'he-IL-AvriNeural' };
const TTS_VOICE_ENV = process.env.TTS_VOICE;
const TTS_CACHE_DIR = path.join(SOUNDS_DIR, 'tts-cache');
if (!fs.existsSync(TTS_CACHE_DIR)) {
  fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
}
const ttsInflight = new Map();

function resolveTtsVoice(v) {
  const pick = (x) => TTS_VOICES[x] || (Object.values(TTS_VOICES).includes(x) ? x : null);
  return pick(v) || pick(TTS_VOICE_ENV) || TTS_VOICES.female;
}

function ttsCachePath(text, voiceName) {
  const hash = crypto.createHash('md5').update(voiceName + '|' + text).digest('hex');
  return path.join(TTS_CACHE_DIR, hash + '.mp3');
}

async function synthesizeTtsToFile(text, outPath, voiceName) {
  const tts = new MsEdgeTTS();
  const tmpPath = outPath + '.' + process.pid + '.tmp';
  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmpPath);
      writer.on('finish', resolve);
      writer.on('error', reject);
      audioStream.on('error', reject);
      audioStream.pipe(writer);
    });
    if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
      throw new Error('TTS produced empty audio');
    }
    fs.renameSync(tmpPath, outPath);
    return outPath;
  } finally {
    try { tts.close(); } catch (e) {}
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}
  }
}

function ensureTtsAudio(text, voice) {
  const voiceName = resolveTtsVoice(voice);
  const outPath = ttsCachePath(text, voiceName);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    return Promise.resolve(outPath);
  }
  if (ttsInflight.has(outPath)) return ttsInflight.get(outPath);
  const p = Promise.race([
    synthesizeTtsToFile(text, outPath, voiceName),
    new Promise((_, reject) => setTimeout(() => reject(new Error('TTS synthesis timed out')), 20000))
  ]).finally(() => ttsInflight.delete(outPath));
  ttsInflight.set(outPath, p);
  return p;
}

function warmTtsCache(data) {
  try {
    const presets = (data && data.settings && data.settings.audio && Array.isArray(data.settings.audio.presets))
      ? data.settings.audio.presets : [];
    const items = new Map();
    const addText = (val, voice) => {
      const text = String(val || '').trim();
      if (text && !text.match(/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i) && !text.startsWith('/sounds/')) {
        items.set(resolveTtsVoice(voice) + '|' + text, { text, voice });
      }
    };
    presets.forEach(p => {
      const isObj = p && typeof p === 'object';
      const type = isObj ? (p.type || 'tts') : 'tts';
      if (type === 'tts') addText(isObj ? (p.value || p.name) : p, isObj ? p.voice : null);
    });
    ((data && data.children) || []).forEach(c => {
      (c.tasks || []).forEach(t => {
        const fb = String(t.audioFeedback || '').trim();
        if (!fb) return;
        const preset = presets.find(p => p && typeof p === 'object' && (p.id === fb || p.value === fb || p.name === fb));
        addText(preset ? (preset.value || preset.name) : fb, preset ? preset.voice : null);
      });
    });
    [...items.values()].reduce((chain, item) => chain.then(() =>
      ensureTtsAudio(item.text, item.voice).catch(err => console.warn(`[TTS] Cache warm failed for "${item.text}":`, err.message))
    ), Promise.resolve()).then(() => console.log('[TTS] Cache warm complete'));
  } catch (err) {
    console.warn('[TTS] Cache warm failed:', err.message);
  }
}

// Helper for local YYYY-MM-DD
function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Icon metadata catalog
const ICON_LABELS = {
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

// Default Home Assistant configuration
const DEFAULT_HASS_CONFIG = {
  enabled: false,
  url: 'http://homeassistant.local:8123',
  token: '',
  tvEntityId: 'switch.tv_socket',
  autoBlockTv: true,
  pollIntervalSeconds: 30,
  targetScope: 'all'
};

// Default initial tasks schema
const DEFAULT_TASKS_DATA = {
  children: [
    {
      id: "child_1",
      name: "אביב",
      tasks: [
        { id: "t1", title: "צחצוח שיניים", completed: false, completedAt: null, icon: "toothbrush" },
        { id: "t2", title: "התלבשות לבד", completed: false, completedAt: null, icon: "clothes" },
        { id: "t3", title: "סידור תיק", completed: false, completedAt: null, icon: "backpack" }
      ]
    },
    {
      id: "child_2",
      name: "דניאל",
      tasks: [
        { id: "t1", title: "צחצוח שיניים", completed: false, completedAt: null, icon: "toothbrush" },
        { id: "t2", title: "התלבשות לבד", completed: false, completedAt: null, icon: "clothes" },
        { id: "t3", title: "סידור תיק", completed: false, completedAt: null, icon: "backpack" }
      ]
    }
  ],
  history: [],
  lastActiveDate: getTodayDateString(),
  homeAssistant: { ...DEFAULT_HASS_CONFIG },
  parentPin: null,
  settings: {
    resetTime: '06:00',
    audio: { presets: ['כל הכבוד!', 'יופי של עבודה!', 'אלוף!'] },
    bypassSchedule: {
      enabled: false,
      schedule: {
        0: { enabled: false, startTime: '15:00', endTime: '21:00' }, // Sunday
        1: { enabled: true,  startTime: '15:00', endTime: '21:00' }, // Monday
        2: { enabled: true,  startTime: '15:00', endTime: '21:00' }, // Tuesday
        3: { enabled: true,  startTime: '15:00', endTime: '21:00' }, // Wednesday
        4: { enabled: true,  startTime: '15:00', endTime: '21:00' }, // Thursday
        5: { enabled: true,  startTime: '13:00', endTime: '22:00' }, // Friday
        6: { enabled: false, startTime: '10:00', endTime: '22:00' }  // Saturday
      }
    }
  }
};

// Detect intelligent default icon from title
function guessIconFromTitle(title) {
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

async function resolveHouseholdIdForSocket(data) {
  const { token, deviceToken } = data || {};
  if (token) {
    if (process.env.NODE_ENV === 'test' || token.startsWith('test_token_')) {
      return 'house_test';
    }
    try {
      const decoded = await getAuth().verifyIdToken(token);
      return getHouseholdIdForUser(decoded.uid, decoded.email);
    } catch (e) {}
  }
  if (deviceToken) {
    const dev = getDeviceByToken(deviceToken);
    if (dev) return dev.householdId;
  }
  if (process.env.NODE_ENV === 'test') {
    return 'house_test';
  }
  return 'house_default';
}

function getAllHouseholdIds() {
  const set = new Set(['house_default']);
  try {
    const registry = readHouseholdsRegistry();
    Object.keys(registry).forEach(id => set.add(id));
  } catch (e) {}
  try {
    const devices = readDevices();
    Object.values(devices).forEach(d => { if (d.householdId) set.add(d.householdId); });
  } catch (e) {}
  return Array.from(set);
}

// Ensure structure completeness without overwriting user data
function normalizeTasksData(data) {
  if (!data) data = JSON.parse(JSON.stringify(DEFAULT_TASKS_DATA));
  if (!Array.isArray(data.children)) data.children = [];
  if (!Array.isArray(data.history)) data.history = [];
  if (!data.lastActiveDate) data.lastActiveDate = getTodayDateString();

  if (data.parentPin === undefined) {
    data.parentPin = null;
  } else if (typeof data.parentPin === 'string') {
    data.parentPin = data.parentPin.trim() || null;
  }

  if (!data.homeAssistant || typeof data.homeAssistant !== 'object') {
    data.homeAssistant = { ...DEFAULT_HASS_CONFIG };
  } else {
    data.homeAssistant = { ...DEFAULT_HASS_CONFIG, ...data.homeAssistant };
  }

  if (!data.settings || typeof data.settings !== 'object') {
    data.settings = JSON.parse(JSON.stringify(DEFAULT_TASKS_DATA.settings));
  } else {
    if (typeof data.settings.resetTime !== 'string') data.settings.resetTime = '06:00';
      if (!data.settings.audio || typeof data.settings.audio !== 'object') {
        data.settings.audio = { presets: [] };
      }
      if (!Array.isArray(data.settings.audio.presets) || data.settings.audio.presets.length === 0) {
        data.settings.audio.presets = [
          { id: 'tts_1', type: 'tts', name: 'כל הכבוד!', value: 'כל הכבוד!', voice: 'female' },
          { id: 'tts_2', type: 'tts', name: 'יופי של עבודה!', value: 'יופי של עבודה!', voice: 'female' },
          { id: 'tts_3', type: 'tts', name: 'אלוף!', value: 'אלוף!', voice: 'female' }
        ];
      } else {
        data.settings.audio.presets = data.settings.audio.presets.map((p, idx) => {
          if (typeof p === 'object' && p !== null) {
            const val = String(p.value || p.name || '').trim();
            const type = (p.type === 'audio' || p.type === 'tts') ? p.type : (val.match(/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i) ? 'audio' : 'tts');
            return {
              id: p.id || (type + '_' + idx),
              type: type,
              name: String(p.name || val).trim(),
              value: val,
              voice: (p.voice === 'male' || p.voice === 'female') ? p.voice : 'female'
            };
          } else {
            const str = String(p).trim();
            const type = str.match(/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i) ? 'audio' : 'tts';
            return {
              id: type + '_' + idx,
              type: type,
              name: str,
              value: str,
              voice: 'female'
            };
          }
        }).filter(p => p.value);
      }
    if (!data.settings.bypassSchedule || typeof data.settings.bypassSchedule !== 'object') {
      data.settings.bypassSchedule = JSON.parse(JSON.stringify(DEFAULT_TASKS_DATA.settings.bypassSchedule));
    } else {
      const bs = data.settings.bypassSchedule;
      if (typeof bs.enabled !== 'boolean') bs.enabled = false;
      // Migrate old flat format (days array + startTime/endTime) to per-day schedule
      if (!bs.schedule || typeof bs.schedule !== 'object') {
        const def = DEFAULT_TASKS_DATA.settings.bypassSchedule.schedule;
        bs.schedule = {};
        for (let d = 0; d <= 6; d++) {
          const wasEnabled = Array.isArray(bs.days) ? bs.days.includes(d) : (def[d] || {}).enabled;
          bs.schedule[d] = {
            enabled: Boolean(wasEnabled),
            startTime: typeof bs.startTime === 'string' ? bs.startTime : (def[d] || {}).startTime || '15:00',
            endTime:   typeof bs.endTime   === 'string' ? bs.endTime   : (def[d] || {}).endTime   || '21:00'
          };
        }
        delete bs.days; delete bs.startTime; delete bs.endTime;
      } else {
        // Ensure all 7 days exist in schedule
        const def = DEFAULT_TASKS_DATA.settings.bypassSchedule.schedule;
        for (let d = 0; d <= 6; d++) {
          if (!bs.schedule[d] || typeof bs.schedule[d] !== 'object') {
            bs.schedule[d] = { ...def[d] };
          } else {
            if (typeof bs.schedule[d].enabled !== 'boolean') bs.schedule[d].enabled = false;
            if (typeof bs.schedule[d].startTime !== 'string') bs.schedule[d].startTime = '15:00';
            if (typeof bs.schedule[d].endTime   !== 'string') bs.schedule[d].endTime   = '21:00';
          }
        }
      }
    }
  }

  // Ensure each task has completedAt, icon, requiresApproval, pendingApproval, and audioFeedback
  data.children.forEach(child => {
    if (!Array.isArray(child.tasks)) child.tasks = [];
    child.tasks.forEach(task => {
      if (task.completed === undefined) task.completed = false;
      if (task.completedAt === undefined) task.completedAt = null;
      if (task.requiresApproval === undefined) task.requiresApproval = false;
      else task.requiresApproval = Boolean(task.requiresApproval);
      if (task.pendingApproval === undefined) task.pendingApproval = false;
      else task.pendingApproval = Boolean(task.pendingApproval);
      if (task.audioFeedback === undefined) task.audioFeedback = '';
      else task.audioFeedback = String(task.audioFeedback).trim();
      if (!task.icon) task.icon = guessIconFromTitle(task.title);
      if (task.enabled === undefined) task.enabled = true;
      else task.enabled = Boolean(task.enabled);
    });
  });

  return data;
}

// Persistence helper functions
// Database Migration & Initialization
function initTasksStorage() {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    // Check for legacy monolithic file
    const legacyPath = path.join(__dirname, 'tasks.json');
    const legacyExists = fs.existsSync(legacyPath);
    let migrationSource = null;

    if (fs.existsSync(DB_TASKS)) {
      try {
        const testData = JSON.parse(fs.readFileSync(DB_TASKS, 'utf-8'));
        if (testData.homeAssistant !== undefined || testData.settings !== undefined) {
          migrationSource = DB_TASKS; // Existing DB_TASKS is monolithic (e.g. from Proxmox setups)
        }
      } catch(e) {}
    } else if (legacyExists) {
      migrationSource = legacyPath;
    }

    if (migrationSource) {
      console.log(`[Storage] Migrating monolithic JSON from ${migrationSource} to modular structure in ${DB_DIR}...`);
      try {
        const oldData = JSON.parse(fs.readFileSync(migrationSource, 'utf-8'));
        fs.copyFileSync(migrationSource, migrationSource + '.backup_migrated');
        
        fs.writeFileSync(DB_TASKS, JSON.stringify({ children: oldData.children || [], lastActiveDate: oldData.lastActiveDate || getTodayDateString() }, null, 2));
        fs.writeFileSync(DB_HISTORY, JSON.stringify(oldData.history || [], null, 2));
        fs.writeFileSync(DB_CONFIG, JSON.stringify({ homeAssistant: oldData.homeAssistant || { ...DEFAULT_HASS_CONFIG }, parentPin: oldData.parentPin || null }, null, 2));
        fs.writeFileSync(DB_SETTINGS, JSON.stringify(oldData.settings || {}, null, 2));
        
        if (migrationSource === legacyPath && DB_TASKS !== legacyPath) {
          fs.renameSync(legacyPath, legacyPath + '.backup_migrated');
        }
        console.log('[Storage] Migration complete.');
      } catch (e) {
        console.error('[Storage Error] Failed to migrate:', e);
      }
    }

    // Initialize any missing files with defaults
    if (!fs.existsSync(DB_TASKS)) fs.writeFileSync(DB_TASKS, JSON.stringify({ children: DEFAULT_TASKS_DATA.children, lastActiveDate: getTodayDateString() }, null, 2));
    if (!fs.existsSync(DB_HISTORY)) fs.writeFileSync(DB_HISTORY, JSON.stringify(DEFAULT_TASKS_DATA.history, null, 2));
    if (!fs.existsSync(DB_CONFIG)) fs.writeFileSync(DB_CONFIG, JSON.stringify({ homeAssistant: { ...DEFAULT_HASS_CONFIG }, parentPin: null }, null, 2));
    if (!fs.existsSync(DB_SETTINGS)) fs.writeFileSync(DB_SETTINGS, JSON.stringify(DEFAULT_TASKS_DATA.settings, null, 2));

  } catch (error) {
    console.error(`[Storage Error] Initializing DB:`, error);
  }
}

function readTasks(householdId = 'house_default') {
  try {
    const rawData = readHouseholdTasks(householdId, DEFAULT_TASKS_DATA);
    return normalizeTasksData(rawData);
  } catch (error) {
    console.error(`[Storage Error] Reading DB for household ${householdId}:`, error);
    return normalizeTasksData(DEFAULT_TASKS_DATA);
  }
}

function writeTasks(data, householdId = 'house_default') {
  try {
    writeHouseholdTasks(householdId, data);
  } catch (error) {
    console.error(`[Storage Error] Writing DB for household ${householdId}:`, error);
  }
}

// Helper: Calculate task completion status
function calculateCompletionStatus(data) {
  let totalTasks = 0;
  let completedTasks = 0;

  (data.children || []).forEach(child => {
    (child.tasks || []).forEach(task => {
      if (task.enabled === false) return;
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

// ==========================================
// Home Assistant (Hass.io) Integration Logic
// ==========================================
function getCleanHassUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}

function getHassHeaders(token) {
  return {
    'Authorization': `Bearer ${token.trim()}`,
    'Content-Type': 'application/json'
  };
}

// Automatically create and sync all entities in Home Assistant
async function createAndSyncAllHassEntities(data) {
  if (!data) data = readTasks();
  const hass = data.homeAssistant;
  if (!hass || !hass.enabled || !hass.url || !hass.token) {
    return { ok: false, message: 'Home Assistant אינו מופעל או שחסרה כתובת/טוקן', entities: [] };
  }

  const cleanUrl = getCleanHassUrl(hass.url);
  const status = calculateCompletionStatus(data);
  const createdEntities = [];

  // Parent Bypass switch state
  const parentBypass = Boolean(hass.parentBypass);

  const allowTv = status.allCompleted || parentBypass;

  async function postEntity(entityId, state, attributes) {
    try {
      const res = await fetch(`${cleanUrl}/api/states/${entityId}`, {
        method: 'POST',
        headers: getHassHeaders(hass.token),
        body: JSON.stringify({ state: String(state), attributes }),
        signal: AbortSignal.timeout(4000)
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
            signal: AbortSignal.timeout(3000)
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
      friendly_name: 'אישור צפייה בטלוויזיה (Kids Tasker)',
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

  // 6. Automatically generate entities for each child
  for (const child of data.children) {
    const enabledTasks = child.tasks.filter(t => t.enabled !== false);
        const total = enabledTasks.length;
    const done = enabledTasks.filter(t => t.completed).length;
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

  // 7. Active TV Block Enforcement on physical/media entity if configured
  if (hass.autoBlockTv && hass.tvEntityId) {
    try {
      const entityId = hass.tvEntityId.trim();
      const stateRes = await fetch(`${cleanUrl}/api/states/${entityId}`, {
        headers: getHassHeaders(hass.token),
        signal: AbortSignal.timeout(4000)
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
            signal: AbortSignal.timeout(4000)
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
    message: `נוצרו ועודכנו ${createdEntities.length} ישויות ב-Home Assistant בהצלחה!`
  };
}

// Debounced background sync to avoid concurrent race conditions
let isSyncingHass = false;
let hassSyncPending = false;

async function syncHassEntitiesDebounced(householdId = 'house_default') {
  if (isSyncingHass) {
    hassSyncPending = true;
    return;
  }
  isSyncingHass = true;
  try {
    do {
      hassSyncPending = false;
      const latestData = readTasks(householdId);
      if (latestData.homeAssistant && latestData.homeAssistant.enabled) {
        await createAndSyncAllHassEntities(latestData);
      }
    } while (hassSyncPending);
  } catch (err) {
    console.error('Error in debounced Home Assistant sync:', err);
  } finally {
    isSyncingHass = false;
  }
}

// Test connectivity and fetch entity state
async function testHassConnection(url, token, entityId) {
  const cleanUrl = getCleanHassUrl(url);
  if (!cleanUrl || !token) {
    return { ok: false, message: 'כתובת שרת וטוקן הינם שדות חובה' };
  }

  try {
    const apiRes = await fetch(`${cleanUrl}/api/`, {
      headers: getHassHeaders(token),
      signal: AbortSignal.timeout(5000)
    });

    if (!apiRes.ok) {
      if (apiRes.status === 401) {
        return { ok: false, message: 'שגיאת אימות: הטוקן (Token) אינו תקין או שפג תוקפו' };
      }
      return { ok: false, message: `השרת החזיר קוד שגיאה: ${apiRes.status}` };
    }

    let entityState = null;
    if (entityId) {
      try {
        const entityRes = await fetch(`${cleanUrl}/api/states/${entityId.trim()}`, {
          headers: getHassHeaders(token),
          signal: AbortSignal.timeout(5000)
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
      message: 'החיבור ל-Home Assistant הצליח באופן מושלם!',
      entityState
    };
  } catch (err) {
    return { ok: false, message: `לא ניתן להתחבר לשרת Home Assistant: ${err.message}` };
  }
}

// ==========================================
// Home Assistant Lovelace Card & WebSocket API
// ==========================================
function generateLovelaceCardConfig(data, host) {
  if (!data) data = readTasks();
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

  if (data.children && data.children.length > 0) {
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

  if (data.homeAssistant && data.homeAssistant.tvEntityId) {
    entities.push({
      type: 'section',
      label: '📺 מכשיר טלוויזיה'
    });
    entities.push({
      entity: data.homeAssistant.tvEntityId.trim(),
      name: 'שקע / מסך טלוויזיה'
    });
  }

  const serverUrl = host ? `http://${host}` : 'http://localhost:3000';
  entities.push({
    type: 'divider'
  });
  entities.push({
    type: 'weblink',
    name: '📱 פתח לוח משימות לטאבלט (Kids Tasker)',
    url: serverUrl,
    icon: 'mdi:tablet-dashboard'
  });

  return {
    type: 'entities',
    title: '📋 לוח משימות לילדים (Kids Tasker)',
    show_header_toggle: false,
    entities: entities
  };
}

function generateLovelaceCardYaml(data, host) {
  const card = generateLovelaceCardConfig(data, host);
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
async function addLovelaceCardToHass(data, host) {
  if (!data) data = readTasks();
  const hass = data.homeAssistant;
  if (!hass || !hass.enabled || !hass.url || !hass.token) {
    return { ok: false, message: 'Home Assistant אינו מופעל או שחסרה כתובת/טוקן' };
  }

  // Ensure all entities are created in HA first
  await createAndSyncAllHassEntities(data);

  const cleanUrl = getCleanHassUrl(hass.url);
  const wsUrl = cleanUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://') + '/api/websocket';
  const cardConfig = generateLovelaceCardConfig(data, host);

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
      ws = new WebSocket(wsUrl, { rejectUnauthorized: false });
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
              // If default dashboard is auto-managed, create a dedicated dashboard
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
      resolve({ ok: false, message: `שגיאת חיבור ל-WebSocket: ${err.message || 'לא ניתן להתחבר לשרת'}` });
    };
  });
}

// ==========================================
// Persistent Home Assistant WebSocket Event Listener
// Subscribes to state_changed events to instantly detect changes from Hassio
// (e.g. Parent TV Bypass toggled in Lovelace or via automations)
// ==========================================
let hassListenerWs = null;
let hassListenerReconnectTimer = null;
let hassListenerSubId = null;

function handleExternalParentBypassChange(isBypass, householdId = (process.env.NODE_ENV === 'test' ? 'house_test' : 'house_default')) {
  try {
    const data = readTasks(householdId);
    if (!data.homeAssistant) {
      data.homeAssistant = { ...DEFAULT_HASS_CONFIG };
    }
    const currentBypass = Boolean(data.homeAssistant.parentBypass);
    if (currentBypass !== isBypass) {
      console.log(`[Home Assistant Event] Parent TV Bypass state changed in Home Assistant to: ${isBypass ? 'ON' : 'OFF'}`);
      data.homeAssistant.parentBypass = isBypass;
      writeTasks(data, householdId);
      io.to(householdId).emit('task_updated', data);
      syncHassEntitiesDebounced(householdId).catch(() => {});
    }
  } catch (err) {
    console.error('Failed to handle external parent bypass state change:', err);
  }
}

function startHassEventListener(householdId = (process.env.NODE_ENV === 'test' ? 'house_test' : 'house_default')) {
  stopHassEventListener();

  const data = readTasks(householdId);
  const hass = data.homeAssistant;
  if (!hass || !hass.enabled || !hass.url || !hass.token) {
    return;
  }

  const cleanUrl = getCleanHassUrl(hass.url);
  if (!cleanUrl) return;
  const wsUrl = cleanUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://') + '/api/websocket';

  let localWs = null;
  try {
    localWs = new WebSocket(wsUrl, { rejectUnauthorized: false });
    hassListenerWs = localWs;
  } catch (err) {
    scheduleHassListenerReconnect();
    return;
  }

  let messageId = 1000;

  localWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'auth_required') {
        localWs.send(JSON.stringify({ type: 'auth', access_token: hass.token.trim() }));
        return;
      }

      if (msg.type === 'auth_ok') {
        hassListenerSubId = messageId++;
        localWs.send(JSON.stringify({
          id: hassListenerSubId,
          type: 'subscribe_events',
          event_type: 'state_changed'
        }));

        // Automatically ensure native input_boolean helper exists in Home Assistant
        localWs.send(JSON.stringify({
          id: messageId++,
          type: 'input_boolean/list'
        }));
        return;
      }

      if (msg.type === 'result' && Array.isArray(msg.result)) {
        const helpers = msg.result;
        const exists = helpers.some(h => h && (h.id === 'kids_tasks_parent_bypass' || h.name === 'kids_tasks_parent_bypass'));
        if (!exists) {
          localWs.send(JSON.stringify({
            id: messageId++,
            type: 'input_boolean/create',
            name: 'kids_tasks_parent_bypass',
            icon: 'mdi:lock-open-variant'
          }));
        }
      }

      if (msg.type === 'event' && msg.event && msg.event.event_type === 'state_changed') {
        const evData = msg.event.data;
        if (evData && evData.entity_id === 'input_boolean.kids_tasks_parent_bypass') {
          const newState = evData.new_state?.state;
          if (newState === 'on' || newState === 'off') {
            handleExternalParentBypassChange(newState === 'on');
          }
        }
      }
    } catch (e) {
      // ignore
    }
  };

  localWs.onclose = () => {
    if (hassListenerWs === localWs) {
      hassListenerWs = null;
      scheduleHassListenerReconnect();
    }
  };

  localWs.onerror = () => {
    if (hassListenerWs === localWs) {
      try { localWs.close(); } catch (e) {}
      hassListenerWs = null;
      scheduleHassListenerReconnect();
    }
  };
}

function stopHassEventListener() {
  if (hassListenerReconnectTimer) {
    clearTimeout(hassListenerReconnectTimer);
    hassListenerReconnectTimer = null;
  }
  if (hassListenerWs) {
    try {
      hassListenerWs.close();
    } catch (e) {}
    hassListenerWs = null;
  }
}

function scheduleHassListenerReconnect() {
  if (hassListenerReconnectTimer) clearTimeout(hassListenerReconnectTimer);
  hassListenerReconnectTimer = setTimeout(() => {
    hassListenerReconnectTimer = null;
    startHassEventListener();
  }, 5000);
}

// Background monitoring loop for active TV block enforcement and sync
let hassPollTimer = null;
function startHassPolling() {
  if (hassPollTimer) clearInterval(hassPollTimer);
  hassPollTimer = setInterval(async () => {
    try {
      const data = readTasks();
      const hass = data.homeAssistant;
      if (hass && hass.enabled && hass.url && hass.token) {
        // Fallback REST check for bypass state
        try {
          const cleanUrl = getCleanHassUrl(hass.url);
          const bypassRes = await fetch(`${cleanUrl}/api/states/input_boolean.kids_tasks_parent_bypass`, {
            headers: getHassHeaders(hass.token),
            signal: AbortSignal.timeout(3000)
          });
          if (bypassRes.ok) {
            const bypassData = await bypassRes.json();
            if (bypassData && (bypassData.state === 'on' || bypassData.state === 'off')) {
              handleExternalParentBypassChange(bypassData.state === 'on');
            }
          }
        } catch (e) {}

        syncHassEntitiesDebounced().catch(() => {});
      }
    } catch (e) {
      // ignore
    }
  }, 30000);
}

// Middleware
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API Endpoint: Available Icons list
app.post('/api/sounds/upload', express.json({limit: '20mb'}), (req, res) => {
  try {
    const { filename, base64 } = req.body;
    if (!filename || !base64) return res.status(400).json({ error: 'Missing data' });
    const buffer = Buffer.from(base64.split(',')[1] || base64, 'base64');
    require('fs').writeFileSync(require('path').join(SOUNDS_DIR, filename), buffer);
    res.json({ success: true, file: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sounds', (req, res) => {
  try {
    if (!fs.existsSync(SOUNDS_DIR)) return res.json({ sounds: [] });
    const files = fs.readdirSync(SOUNDS_DIR).filter(f => f.match(/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i));
    res.json({ sounds: files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read sounds directory' });
  }
});

// API Endpoint: Server-side TTS, returns a cached mp3
app.get('/api/tts', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Missing text' });
    if (text.length > 500) return res.status(400).json({ error: 'Text too long' });
    const filePath = await ensureTtsAudio(text, req.query.voice);
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch (err) {
    console.error('[TTS] Generation failed:', err);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

// --- Firebase Config Endpoint for Frontend ---
app.get('/api/auth/config', (req, res) => {
  try {
    const possiblePaths = [
      path.join(__dirname, 'firebaseConfig.json'),
      path.join(__dirname, 'db', 'firebaseConfig.json')
    ];
    let config = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          config = JSON.parse(fs.readFileSync(p, 'utf8'));
          break;
        } catch (e) {}
      }
    }
    if (!config && process.env.FIREBASE_CONFIG) {
      try {
        config = typeof process.env.FIREBASE_CONFIG === 'string'
          ? JSON.parse(process.env.FIREBASE_CONFIG)
          : process.env.FIREBASE_CONFIG;
      } catch (e) {}
    }
    res.json({ success: true, config: config || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Device Pairing API Endpoints ---
app.post('/api/devices/init-pairing', (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'unknown';
    const session = initPairingSession(ip, userAgent);
    res.json({
      success: true,
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      code: session.code,
      expiresAt: session.expiresAt
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/devices/pairing-status', (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ paired: false, error: 'Missing sessionId' });
    const sessions = readPairingSessions();
    const sess = sessions[sessionId];
    if (!sess) return res.status(404).json({ paired: false, error: 'Session not found' });
    if (sess.status === 'paired') {
      return res.json({ paired: true, deviceToken: sess.deviceToken, householdId: sess.householdId });
    }
    res.json({ paired: false, status: sess.status });
  } catch (err) {
    res.status(500).json({ paired: false, error: err.message });
  }
});

app.post('/api/devices/pair', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const { code, deviceName } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Missing pairing code' });
    const result = pairDevice(code, req.householdId, deviceName);

    // Emit socket event for instantaneous pairing on TV
    io.emit(`device_paired_${result.sessionId}`, {
      success: true,
      deviceToken: result.deviceToken,
      householdId: result.householdId,
      deviceName: result.deviceName
    });

    res.json({ success: true, device: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/devices/allowed', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const devices = getHouseholdDevices(req.householdId);
    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/revoke', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ success: false, error: 'Missing deviceId' });
    const revoked = revokeDevice(deviceId, req.householdId);

    // Emit socket event to force TV to clear token and return to QR screen
    io.emit(`device_revoked_${deviceId}`, {
      success: true,
      deviceId,
      message: 'Device authorization revoked'
    });

    res.json({ success: true, revoked });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- Family / Household Management Endpoints ----
app.get('/api/household/my-household', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const info = getHouseholdInfo(req.householdId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'משפחה לא נמצאה' });
    }
    res.json({ success: true, household: info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/household/create', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const { name } = req.body || {};
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : '';
    if (!uid) return res.status(401).json({ success: false, error: 'לא מחובר' });

    const info = createHousehold(uid, email, name);
    io.to(info.householdId).emit('household_updated', info);
    res.json({ success: true, household: info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/household/join', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const { joinCode } = req.body || {};
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : '';
    if (!uid) return res.status(401).json({ success: false, error: 'לא מחובר' });

    const info = joinHouseholdByCode(uid, email, joinCode);
    io.to(info.householdId).emit('household_updated', info);
    res.json({ success: true, household: info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/household/leave', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const email = req.user ? req.user.email : '';
    if (!uid) return res.status(401).json({ success: false, error: 'לא מחובר' });

    const oldHouseholdId = req.householdId;
    const info = leaveHousehold(uid, email);
    if (oldHouseholdId) {
      const oldInfo = getHouseholdInfo(oldHouseholdId);
      if (oldInfo) io.to(oldHouseholdId).emit('household_updated', oldInfo);
    }
    res.json({ success: true, household: info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/household/members/:targetUid', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const { targetUid } = req.params;
    if (!uid) return res.status(401).json({ success: false, error: 'לא מחובר' });

    const info = removeMemberFromHousehold(uid, targetUid);
    io.to(info.householdId).emit('household_updated', info);
    res.json({ success: true, household: info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/household/rename', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const { name } = req.body || {};
    if (!uid) return res.status(401).json({ success: false, error: 'לא מחובר' });

    const info = renameHousehold(uid, name);
    io.to(info.householdId).emit('household_updated', info);
    res.json({ success: true, household: info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/household/transfer-owner', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const uid = req.user ? req.user.uid : null;
    const { newOwnerUid } = req.body || {};
    if (!uid) return res.status(401).json({ success: false, error: 'לא מחובר' });

    const info = transferOwnership(uid, newOwnerUid);
    io.to(info.householdId).emit('household_updated', info);
    res.json({ success: true, household: info });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/icons', (req, res) => {
  try {
    const files = fs.readdirSync(ICONS_DIR).filter(f => f.endsWith('.svg'));
    const icons = files.map(file => {
      const id = path.basename(file, '.svg');
      const meta = ICON_LABELS[id] || { name: id, emoji: '✨' };
      return {
        id,
        name: meta.name,
        emoji: meta.emoji,
        filename: file,
        url: `/icons/${file}`
      };
    });
    res.json(icons);
  } catch (err) {
    console.error('Failed to read icons:', err);
    res.status(500).json({ error: 'Failed to read icons' });
  }
});

// API Endpoint: Public Status endpoint formatted for Home Assistant REST Sensor
app.get('/api/hass/status', (req, res, next) => {
  verifyAuth(req, res, () => next()).catch(() => next());
}, (req, res) => {
  try {
    const householdId = req.householdId || 'house_default';
    const data = readTasks(householdId);
    const status = calculateCompletionStatus(data);
    const parentBypass = Boolean(data.homeAssistant?.parentBypass);
    const allowTv = status.allCompleted || parentBypass;

    const childrenSummary = data.children.map(c => {
      const total = c.tasks.length;
      const done = c.tasks.filter(t => t.completed).length;
      return {
        id: c.id,
        name: c.name,
        completed: total > 0 && done === total,
        total_tasks: total,
        completed_tasks: done,
        remaining_tasks: total - done
      };
    });

    res.json({
      all_completed: status.allCompleted,
      parent_bypass: parentBypass,
      total_tasks: status.totalTasks,
      completed_tasks: status.completedTasks,
      remaining_tasks: status.remainingTasks,
      percentage: status.percentage,
      allow_tv: allowTv,
      tv_blocked: Boolean(data.homeAssistant?.enabled && data.homeAssistant?.autoBlockTv && !allowTv),
      children: childrenSummary,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate Home Assistant status' });
  }
});

// API Endpoint: Toggle Parent TV Bypass
app.post('/api/hass/bypass', verifyAuth, requireParentAuth, async (req, res) => {
  try {
    const householdId = req.householdId || 'house_default';
    const data = readTasks(householdId);
    if (!data.homeAssistant) {
      data.homeAssistant = { ...DEFAULT_HASS_CONFIG };
    }

    let enabled;
    if (req.body.enabled !== undefined) {
      enabled = Boolean(req.body.enabled);
    } else if (req.body.bypass !== undefined) {
      enabled = Boolean(req.body.bypass);
    } else if (req.body.state !== undefined) {
      enabled = (req.body.state === 'on' || req.body.state === true);
    } else {
      // Toggle if no payload provided
      enabled = !Boolean(data.homeAssistant.parentBypass);
    }

    data.homeAssistant.parentBypass = enabled;
    writeTasks(data, householdId);

    // Sync state directly into Home Assistant entity
    if (data.homeAssistant.enabled && data.homeAssistant.url && data.homeAssistant.token) {
      const cleanUrl = getCleanHassUrl(data.homeAssistant.url);
      try {
        await fetch(`${cleanUrl}/api/states/input_boolean.kids_tasks_parent_bypass`, {
          method: 'POST',
          headers: getHassHeaders(data.homeAssistant.token),
          body: JSON.stringify({
            state: enabled ? 'on' : 'off',
            attributes: {
              friendly_name: 'מעקף הורים - אישור צפייה בטלוויזיה',
              icon: enabled ? 'mdi:lock-open-variant' : 'mdi:lock',
              description: 'כאשר מופעל, הטלוויזיה מותרת גם אם טרם הושלמו כל המשימות'
            }
          }),
          signal: AbortSignal.timeout(4000)
        });
      } catch (e) {}

      // Also call service for native Home Assistant helpers if available
      try {
        await fetch(`${cleanUrl}/api/services/input_boolean/${enabled ? 'turn_on' : 'turn_off'}`, {
          method: 'POST',
          headers: getHassHeaders(data.homeAssistant.token),
          body: JSON.stringify({ entity_id: 'input_boolean.kids_tasks_parent_bypass' }),
          signal: AbortSignal.timeout(3000)
        });
      } catch (e) {}

      syncHassEntitiesDebounced(householdId).catch(() => {});
    }

    io.to(householdId).emit('task_updated', data);
    res.json({ success: true, parentBypass: enabled });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API Endpoints: Home Assistant Configuration & Testing & Entity Creation
app.get('/api/hass/config', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const data = readTasks(req.householdId);
    const config = data.homeAssistant || { ...DEFAULT_HASS_CONFIG };
    const maskedToken = config.token && config.token.length > 8 
      ? config.token.substring(0, 4) + '••••••••' + config.token.substring(config.token.length - 4)
      : (config.token ? '••••••••' : '');

    res.json({
      ...config,
      tokenMasked: maskedToken,
      hasToken: Boolean(config.token && config.token.trim())
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read Home Assistant configuration' });
  }
});

app.post('/api/hass/config', verifyAuth, requireParentAuth, async (req, res) => {
  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const currentHass = data.homeAssistant || { ...DEFAULT_HASS_CONFIG };
    const { enabled, url, token, tvEntityId, autoBlockTv, pollIntervalSeconds, targetScope } = req.body;

    data.homeAssistant = {
      enabled: enabled !== undefined ? Boolean(enabled) : currentHass.enabled,
      url: url !== undefined ? url.trim() : currentHass.url,
      token: (token && !token.includes('••••')) ? token.trim() : currentHass.token,
      tvEntityId: tvEntityId !== undefined ? tvEntityId.trim() : currentHass.tvEntityId,
      autoBlockTv: autoBlockTv !== undefined ? Boolean(autoBlockTv) : currentHass.autoBlockTv,
      pollIntervalSeconds: Number(pollIntervalSeconds) || currentHass.pollIntervalSeconds || 30,
      targetScope: targetScope || currentHass.targetScope || 'all'
    };

    writeTasks(data, householdId);
    io.to(householdId).emit('task_updated', data);

    // Automatically create and sync entities immediately in Home Assistant
    if (data.homeAssistant.enabled) {
      syncHassEntitiesDebounced(householdId).catch(() => {});
      startHassEventListener();
    } else {
      stopHassEventListener();
    }

    res.json({ success: true, message: 'הגדרות Home Assistant נשמרו בהצלחה', config: data.homeAssistant });
  } catch (error) {
    console.error('Failed to save Home Assistant configuration:', error);
    res.status(500).json({ error: 'Failed to save Home Assistant configuration' });
  }
});

app.post('/api/hass/test', verifyAuth, requireParentAuth, async (req, res) => {
  try {
    const data = readTasks(req.householdId);
    const currentHass = data.homeAssistant || { ...DEFAULT_HASS_CONFIG };

    const url = req.body.url || currentHass.url;
    let token = req.body.token;
    if (!token || token.includes('••••')) {
      token = currentHass.token;
    }
    const tvEntityId = req.body.tvEntityId || currentHass.tvEntityId;

    const result = await testHassConnection(url, token, tvEntityId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

// API Endpoint: Explicitly trigger creation and return the list of created entities in Home Assistant
app.post('/api/hass/create-entities', verifyAuth, requireParentAuth, async (req, res) => {
  try {
    const data = readTasks(req.householdId);
    const result = await createAndSyncAllHassEntities(data);
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.message });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Failed to create Home Assistant entities:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API Endpoint: Automatically inject/append Lovelace card into Home Assistant dashboard via WebSocket
app.post('/api/hass/add-card', verifyAuth, requireParentAuth, async (req, res) => {
  try {
    const data = readTasks(req.householdId);
    const host = req.get('host') || req.headers.host;
    const result = await addLovelaceCardToHass(data, host);
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.message });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Failed to add Lovelace card:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API Endpoint: Get Lovelace card YAML code and configuration
app.get('/api/hass/card-yaml', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const data = readTasks(req.householdId);
    const host = req.get('host') || req.headers.host;
    const yaml = generateLovelaceCardYaml(data, host);
    const card = generateLovelaceCardConfig(data, host);
    res.json({ success: true, yaml, card });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// Parent Access PIN Protection Endpoints
// ==========================================

// Check if a parent PIN is configured
app.get('/api/parent/pin-status', verifyAuth, (req, res) => {
  try {
    const householdId = req.householdId || 'house_default';
    const data = readTasks(householdId);
    const hasPin = Boolean(data.parentPin && String(data.parentPin).trim().length >= 4);
    res.json({ success: true, hasPin });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve PIN status' });
  }
});

// Verify entered parent PIN
app.post('/api/parent/verify-pin', verifyAuth, (req, res) => {
  try {
    const { pin } = req.body || {};
    const householdId = req.householdId || 'house_default';
    const data = readTasks(householdId);
    const existingPin = data.parentPin ? String(data.parentPin).trim() : null;

    // If no PIN has been set yet, any verification is bypassed / indicates setup needed
    if (!existingPin || existingPin.length < 4) {
      return res.json({ success: true, needsSetup: true });
    }

    const cleanPin = String(pin || '').trim();
    if (cleanPin === existingPin) {
      return res.json({ success: true, message: 'קוד ה-PIN אומת בהצלחה' });
    }

    return res.status(401).json({ success: false, error: 'קוד ה-PIN שגוי. נסה שוב.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to verify PIN' });
  }
});

// Set or change parent PIN (4-6 digits)
app.post('/api/parent/set-pin', verifyAuth, (req, res) => {
  try {
    const { pin, confirmPin, currentPin } = req.body || {};
    const householdId = req.householdId || 'house_default';
    const data = readTasks(householdId);
    const existingPin = data.parentPin ? String(data.parentPin).trim() : null;

    // If a PIN already exists, require valid currentPin unless caller is an authenticated parent user
    if (existingPin && existingPin.length >= 4 && !req.user) {
      if (!currentPin || String(currentPin).trim() !== existingPin) {
        return res.status(401).json({ success: false, error: 'קוד ה-PIN הנוכחי אינו נכון.' });
      }
    }

    const cleanPin = String(pin || '').trim();
    const cleanConfirm = (confirmPin !== undefined && confirmPin !== null) ? String(confirmPin).trim() : cleanPin;

    if (!/^\d{4,6}$/.test(cleanPin)) {
      return res.status(400).json({ success: false, error: 'על קוד ה-PIN להכיל בין 4 ל-6 ספרות בלבד.' });
    }

    if (cleanPin !== cleanConfirm) {
      return res.status(400).json({ success: false, error: 'אימות הקוד אינו תואם לקוד שהוקלד.' });
    }

    data.parentPin = cleanPin;
    writeTasks(data, householdId);

    res.json({ success: true, message: 'קוד ה-PIN נשמר בהצלחה!' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to save PIN' });
  }
});

// API Endpoints: Tasks
app.get('/api/tasks', verifyAuth, (req, res) => {
  try {
    const tasks = readTasks(req.householdId);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve tasks' });
  }
});

app.post('/api/tasks/toggle', verifyAuth, (req, res) => {
  const { childId, taskId, isParent } = req.body;

  if (!childId || !taskId) {
    return res.status(400).json({ error: 'childId and taskId are required' });
  }

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const child = data.children.find(c => c.id === childId);

    if (!child) {
      return res.status(404).json({ error: `Child with id ${childId} not found` });
    }

    const task = child.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: `Task with id ${taskId} not found for child ${childId}` });
    }

    const parentToggle = isParent !== undefined ? Boolean(isParent) : Boolean(req.isParent);

    if (parentToggle) {
      // Parent toggling
      if (task.completed) {
        task.completed = false;
        task.completedAt = null;
        task.pendingApproval = false;
      } else {
        task.completed = true;
        task.completedAt = new Date().toISOString();
        task.pendingApproval = false;
      }
    } else {
      // Child toggling
      if (task.completed) {
        return res.status(403).json({ error: 'משימה שסומנה כבוצעה ניתנת לשינוי רק על ידי ההורים' });
      }

      if (task.requiresApproval) {
        // If task requires parent approval, set pendingApproval to true (orange state, NOT completed)
        task.pendingApproval = true;
        task.completed = false;
        task.completedAt = null;
      } else {
        task.completed = true;
        task.completedAt = new Date().toISOString();
        task.pendingApproval = false;
      }
    }

    // Record into daily history
    const historyEntry = {
      id: `h_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      date: getTodayDateString(),
      timestamp: new Date().toISOString(),
      childId: child.id,
      childName: child.name,
      taskId: task.id,
      taskTitle: task.title,
      icon: task.icon || 'star',
      completed: task.completed,
      pendingApproval: Boolean(task.pendingApproval),
      completedAt: task.completedAt
    };

    data.history.unshift(historyEntry);

    if (data.history.length > 2000) {
      data.history = data.history.slice(0, 2000);
    }

    // Persist directly to JSON file
    writeTasks(data, householdId);

    // Broadcast updated state to room clients
    io.to(householdId).emit('task_updated', data);

    // Automatically sync updated entities with Home Assistant & enforce TV block
    syncHassEntitiesDebounced(householdId).catch(() => {});

    res.json({
      success: true,
      childId,
      taskId,
      completed: task.completed,
      pendingApproval: Boolean(task.pendingApproval),
      completedAt: task.completedAt,
      icon: task.icon,
      data
    });
  } catch (error) {
    console.error('Failed to toggle task:', error);
    res.status(500).json({ error: 'Failed to toggle task' });
  }
});

app.post('/api/tasks/approve', verifyAuth, requireParentAuth, (req, res) => {
  const { childId, taskId } = req.body;

  if (!childId || !taskId) {
    return res.status(400).json({ error: 'childId and taskId are required' });
  }

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const child = data.children.find(c => c.id === childId);

    if (!child) {
      return res.status(404).json({ error: `Child with id ${childId} not found` });
    }

    const task = child.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: `Task with id ${taskId} not found for child ${childId}` });
    }

    task.completed = true;
    task.completedAt = new Date().toISOString();
    task.pendingApproval = false;

    const historyEntry = {
      id: `h_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      date: getTodayDateString(),
      timestamp: new Date().toISOString(),
      childId: child.id,
      childName: child.name,
      taskId: task.id,
      taskTitle: task.title,
      icon: task.icon || 'star',
      completed: true,
      pendingApproval: false,
      completedAt: task.completedAt
    };

    data.history.unshift(historyEntry);

    if (data.history.length > 2000) {
      data.history = data.history.slice(0, 2000);
    }

    writeTasks(data, householdId);
    io.to(householdId).emit('task_updated', data);
    syncHassEntitiesDebounced(householdId).catch(() => {});

    res.json({
      success: true,
      childId,
      taskId,
      completed: true,
      pendingApproval: false,
      completedAt: task.completedAt,
      icon: task.icon,
      data
    });
  } catch (error) {
    console.error('Failed to approve task:', error);
    res.status(500).json({ error: 'Failed to approve task' });
  }
});

// Shared helper: perform a day reset (used by API route and scheduler)
function performResetDay(householdId = 'house_default') {
  const data = readTasks(householdId);
  data.children.forEach(child => {
    child.tasks.forEach(task => {
      task.completed = false;
      task.completedAt = null;
      task.pendingApproval = false;
    });
  });
  data.lastActiveDate = getTodayDateString();
  writeTasks(data, householdId);
  io.to(householdId).emit('task_updated', data);
  syncHassEntitiesDebounced(householdId).catch(() => {});
  return data;
}

// API Endpoint: Reset day's task states (keeps children, names, tasks, and history!)
app.post('/api/tasks/reset-day', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const data = performResetDay(req.householdId);
    res.json({ success: true, message: 'All daily tasks have been reset', data });
  } catch (error) {
    console.error('Failed to reset daily tasks:', error);
    res.status(500).json({ error: 'Failed to reset daily tasks' });
  }
});

// API Endpoint: Get settings
app.get('/api/settings', verifyAuth, (req, res) => {
  try {
    const data = readTasks(req.householdId);
    res.json(data.settings || {});
  } catch (error) {
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

// API Endpoint: Save settings
app.post('/api/settings', verifyAuth, requireParentAuth, (req, res) => {
  try {
    const { resetTime, bypassSchedule, audio } = req.body;
    const householdId = req.householdId;
    const data = readTasks(householdId);
    if (!data.settings) data.settings = JSON.parse(JSON.stringify(DEFAULT_TASKS_DATA.settings));
    if (resetTime !== undefined) {
      data.settings.resetTime = (typeof resetTime === 'string') ? resetTime.trim() : '';
    }
    if (bypassSchedule && typeof bypassSchedule === 'object') {
      const newBs = { enabled: Boolean(bypassSchedule.enabled), schedule: {} };
      const defSched = DEFAULT_TASKS_DATA.settings.bypassSchedule.schedule;
      for (let d = 0; d <= 6; d++) {
        const dayIn = bypassSchedule.schedule && bypassSchedule.schedule[d];
        newBs.schedule[d] = {
          enabled:   dayIn ? Boolean(dayIn.enabled)   : (defSched[d] || {}).enabled || false,
          startTime: dayIn && typeof dayIn.startTime === 'string' ? dayIn.startTime : (defSched[d] || {}).startTime || '15:00',
          endTime:   dayIn && typeof dayIn.endTime   === 'string' ? dayIn.endTime   : (defSched[d] || {}).endTime   || '21:00'
        };
      }
      data.settings.bypassSchedule = newBs;
    }
    if (audio && typeof audio === 'object') {
      if (!data.settings.audio) data.settings.audio = {};
      if (Array.isArray(audio.presets)) {
        // Collect active audio identifiers currently used by any task
        const activeUsedSounds = new Set();
        (data.children || []).forEach(c => {
          (c.tasks || []).forEach(t => {
            if (t.audioFeedback) activeUsedSounds.add(t.audioFeedback);
          });
        });

        const newPresets = audio.presets.map((p, idx) => {
          if (typeof p === 'object' && p !== null) {
            const val = String(p.value || p.name || '').trim();
            const type = (p.type === 'audio' || p.type === 'tts') ? p.type : (val.match(/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i) ? 'audio' : 'tts');
            return {
              id: p.id || (type + '_' + Date.now() + '_' + idx),
              type: type,
              name: String(p.name || val).trim(),
              value: val,
              voice: (p.voice === 'male' || p.voice === 'female') ? p.voice : 'female'
            };
          } else {
            const str = String(p).trim();
            const type = str.match(/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i) ? 'audio' : 'tts';
            return {
              id: type + '_' + Date.now() + '_' + idx,
              type: type,
              name: str,
              value: str,
              voice: 'female'
            };
          }
        }).filter(p => p.value);

        // Retain any preset that is in use if client tried to remove it
        const oldPresets = Array.isArray(data.settings.audio.presets) ? data.settings.audio.presets : [];
        oldPresets.forEach(oldP => {
          const oldVal = typeof oldP === 'object' ? (oldP.value || oldP.name) : oldP;
          const oldName = typeof oldP === 'object' ? oldP.name : oldP;
          const oldId = typeof oldP === 'object' ? oldP.id : null;
          
          if (activeUsedSounds.has(oldVal) || activeUsedSounds.has(oldName) || (oldId && activeUsedSounds.has(oldId))) {
            const alreadyIn = newPresets.some(np => np.value === oldVal || np.name === oldName || (oldId && np.id === oldId));
            if (!alreadyIn) {
              newPresets.push(typeof oldP === 'object' ? oldP : {
                id: 'retained_' + Date.now(),
                type: String(oldVal).match(/\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i) ? 'audio' : 'tts',
                name: oldVal,
                value: oldVal
              });
            }
          }
        });

        data.settings.audio.presets = newPresets;
      }
    }
    writeTasks(data, householdId);
    warmTtsCache(data);
    res.json({ success: true, settings: data.settings });
  } catch (error) {
    console.error('Failed to save settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// API Endpoint: History retrieval
app.get('/api/history', verifyAuth, (req, res) => {
  try {
    const data = readTasks(req.householdId);
    const { date, childId } = req.query;

    let filtered = data.history || [];
    if (date) {
      filtered = filtered.filter(h => h.date === date);
    }
    if (childId) {
      filtered = filtered.filter(h => h.childId === childId);
    }

    const dates = Array.from(new Set((data.history || []).map(h => h.date))).sort().reverse();
    res.json({ history: filtered, availableDates: dates });
  } catch (error) {
    console.error('Failed to retrieve history:', error);
    res.status(500).json({ error: 'Failed to retrieve history' });
  }
});

// API Endpoints: Children Management (CRUD)
app.post('/api/children', verifyAuth, requireParentAuth, (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Child name is required' });
  }

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const newChild = {
      id: `child_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim(),
      tasks: []
    };

    data.children.push(newChild);
    writeTasks(data, householdId);
    io.to(householdId).emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.status(201).json({ success: true, child: newChild });
  } catch (error) {
    console.error('Failed to add child:', error);
    res.status(500).json({ error: 'Failed to add child' });
  }
});

app.put('/api/children/:id', verifyAuth, requireParentAuth, (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Child name is required' });
  }

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const child = data.children.find(c => c.id === id);
    if (!child) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    child.name = name.trim();
    writeTasks(data, householdId);
    io.to(householdId).emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.json({ success: true, child });
  } catch (error) {
    console.error('Failed to update child:', error);
    res.status(500).json({ error: 'Failed to update child' });
  }
});

app.delete('/api/children/:id', verifyAuth, requireParentAuth, (req, res) => {
  const { id } = req.params;

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const childIndex = data.children.findIndex(c => c.id === id);
    if (childIndex === -1) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    const removedChild = data.children.splice(childIndex, 1)[0];
    writeTasks(data, householdId);
    io.to(householdId).emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.json({ success: true, removed: removedChild });
  } catch (error) {
    console.error('Failed to delete child:', error);
    res.status(500).json({ error: 'Failed to delete child' });
  }
});

// API Endpoints: Task Management (CRUD per child)
app.post('/api/children/:id/tasks', verifyAuth, requireParentAuth, (req, res) => {
  const { id } = req.params;
  const { title, icon } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Task title is required' });
  }

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const child = data.children.find(c => c.id === id);
    if (!child) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    const assignedIcon = icon || guessIconFromTitle(title);

    const newTask = {
      id: `t_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: title.trim(),
      completed: false,
      completedAt: null,
      icon: assignedIcon,
      requiresApproval: Boolean(req.body.requiresApproval),
      audioFeedback: typeof req.body.audioFeedback === 'string' ? req.body.audioFeedback.trim() : '',
      enabled: req.body.enabled !== undefined ? Boolean(req.body.enabled) : true
    };

    child.tasks.push(newTask);
    writeTasks(data, householdId);
    io.to(householdId).emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.status(201).json({ success: true, task: newTask });
  } catch (error) {
    console.error('Failed to add task:', error);
    res.status(500).json({ error: 'Failed to add task' });
  }
});

app.put('/api/children/:id/tasks/:taskId', verifyAuth, requireParentAuth, (req, res) => {
  const { id, taskId } = req.params;
  const { title, icon } = req.body;

  if (!title && !icon && req.body.requiresApproval === undefined && req.body.audioFeedback === undefined && req.body.enabled === undefined) {
    return res.status(400).json({ error: 'At least one field is required to update task' });
  }

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const child = data.children.find(c => c.id === id);
    if (!child) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    const task = child.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: `Task with id ${taskId} not found for child ${id}` });
    }

    if (title && typeof title === 'string') task.title = title.trim();
    if (icon && typeof icon === 'string') task.icon = icon.trim();
    if (req.body.requiresApproval !== undefined) task.requiresApproval = Boolean(req.body.requiresApproval);
    if (req.body.audioFeedback !== undefined) task.audioFeedback = String(req.body.audioFeedback).trim();
    if (req.body.enabled !== undefined) task.enabled = Boolean(req.body.enabled);

    const changes = {};
    if (title !== undefined && typeof title === 'string') changes.title = task.title;
    if (icon !== undefined && typeof icon === 'string') changes.icon = task.icon;
    if (req.body.requiresApproval !== undefined) changes.requiresApproval = task.requiresApproval;
    if (req.body.audioFeedback !== undefined) changes.audioFeedback = task.audioFeedback;
    if (req.body.enabled !== undefined) changes.enabled = task.enabled;

    writeTasks(data, householdId);
    io.to(householdId).emit('task_delta', {
      childId: id,
      taskId: taskId,
      changes: changes
    });
    createAndSyncAllHassEntities(data).catch(() => {});

    res.json({ success: true, task });
  } catch (error) {
    console.error('Failed to update task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/children/:id/tasks/:taskId', verifyAuth, requireParentAuth, (req, res) => {
  const { id, taskId } = req.params;

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const child = data.children.find(c => c.id === id);
    if (!child) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    const taskIndex = child.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      return res.status(404).json({ error: `Task with id ${taskId} not found for child ${id}` });
    }

    const removedTask = child.tasks.splice(taskIndex, 1)[0];
    writeTasks(data, householdId);
    io.to(householdId).emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.json({ success: true, removed: removedTask });
  } catch (error) {
    console.error('Failed to delete task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Reorder tasks for a child
app.post('/api/children/:id/tasks/reorder', verifyAuth, requireParentAuth, (req, res) => {
  const { id } = req.params;
  const { taskIds } = req.body;

  if (!Array.isArray(taskIds)) {
    return res.status(400).json({ error: 'taskIds must be an array' });
  }

  try {
    const householdId = req.householdId;
    const data = readTasks(householdId);
    const child = data.children.find(c => c.id === id);
    if (!child) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    // Rebuild tasks in the order specified, ignoring unknown IDs
    const taskMap = Object.fromEntries(child.tasks.map(t => [t.id, t]));
    const reordered = taskIds.map(tid => taskMap[tid]).filter(Boolean);
    // Append any tasks not included in taskIds (safety)
    child.tasks.forEach(t => { if (!taskIds.includes(t.id)) reordered.push(t); });
    child.tasks = reordered;

    writeTasks(data, householdId);
    io.to(householdId).emit('task_updated', data);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to reorder tasks:', error);
    res.status(500).json({ error: 'Failed to reorder tasks' });
  }
});


// Serve Angular static files
app.use(express.static(path.join(__dirname, 'frontend/dist/browser')));

// Fallback for Angular Router
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/icons/') || req.path.startsWith('/sounds/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'frontend/dist/browser/index.html'));
});

// Socket.io connection logging & room isolation
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  resolveHouseholdIdForSocket(socket.handshake.auth || socket.handshake.query).then(hId => {
    socket.householdId = hId;
    socket.join(hId);
    console.log(`[Socket] Initial room for ${socket.id}: ${hId}`);
  }).catch(() => {});

  socket.on('join_household', async (data) => {
    const householdId = await resolveHouseholdIdForSocket(data);
    if (socket.householdId && socket.householdId !== householdId) {
      socket.leave(socket.householdId);
    }
    socket.householdId = householdId;
    socket.join(householdId);
    console.log(`[Socket] Client ${socket.id} joined room ${householdId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start Server after initializing storage
function start() {
  initTasksStorage();
  startHassPolling();
  startHassEventListener();

  // ---- Settings-based scheduler: auto-reset + bypass schedule per household ----
  const schedulerState = new Map();

  function runScheduler() {
    try {
      const householdIds = getAllHouseholdIds();
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const timeNow = `${hh}:${mm}`;
      const todayStr = getTodayDateString();
      const dayOfWeek = now.getDay(); // 0=Sunday

      for (const householdId of householdIds) {
        let state = schedulerState.get(householdId);
        if (!state) {
          state = { lastAutoResetMarker: null, lastScheduledBypassState: null };
          schedulerState.set(householdId, state);
        }

        const data = readTasks(householdId);
        const settings = data.settings || {};

        // --- Auto-reset tasks ---
        const resetTime = (settings.resetTime || '').trim();
        const currentResetMarker = `${todayStr}-${timeNow}`;

        if (resetTime && timeNow === resetTime && state.lastAutoResetMarker !== currentResetMarker) {
          console.log(`[Scheduler] Auto-resetting tasks for household ${householdId} at ${resetTime}`);
          state.lastAutoResetMarker = currentResetMarker;
          performResetDay(householdId);
        }

        // --- Bypass schedule ---
        const bs = settings.bypassSchedule;
        if (bs && bs.enabled && bs.schedule) {
          const dayConfig = bs.schedule[dayOfWeek];
          let shouldBypass = false;
          if (dayConfig && dayConfig.enabled && dayConfig.startTime && dayConfig.endTime) {
            if (dayConfig.endTime > dayConfig.startTime) {
              shouldBypass = timeNow >= dayConfig.startTime && timeNow < dayConfig.endTime;
            } else {
              // Overnight window (e.g. 22:00–06:00)
              shouldBypass = timeNow >= dayConfig.startTime || timeNow < dayConfig.endTime;
            }
          }
          if (shouldBypass !== state.lastScheduledBypassState) {
            state.lastScheduledBypassState = shouldBypass;
            console.log(`[Scheduler] Household ${householdId} Bypass schedule: ${shouldBypass ? 'ACTIVATING' : 'DEACTIVATING'} bypass`);
            data.homeAssistant.parentBypass = shouldBypass;
            writeTasks(data, householdId);
            io.to(householdId).emit('task_updated', data);
            syncHassEntitiesDebounced(householdId).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error:', err);
    }
  }

  setInterval(runScheduler, 20 * 1000);
  console.log('[Scheduler] Task auto-reset and bypass schedule running every 20s');

  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` Kids Tasker Server is running on port ${PORT}`);
    console.log(` Server Local Time: ${new Date().toString()}`);
    console.log(` Kids Board URL:    http://localhost:${PORT}`);
    console.log(` Parents Dash URL:  http://localhost:${PORT}/parent`);
    console.log(` HASS Status API:   http://localhost:${PORT}/api/hass/status`);
    console.log(` Database dir:      ${DB_DIR}`);
    console.log(`====================================================`);
  });

  warmTtsCache(readTasks());
}

start();
