const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');

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
const TASKS_FILE = process.env.TASKS_FILE || path.join(__dirname, 'tasks.json');
const ICONS_DIR = path.join(__dirname, 'icons');

// Serve icons directory statically
app.use('/icons', express.static(ICONS_DIR));

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
  parentPin: null
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

  // Ensure each task has completedAt and icon
  data.children.forEach(child => {
    if (!Array.isArray(child.tasks)) child.tasks = [];
    child.tasks.forEach(task => {
      if (task.completed === undefined) task.completed = false;
      if (task.completedAt === undefined) task.completedAt = null;
      if (!task.icon) task.icon = guessIconFromTitle(task.title);
    });
  });

  return data;
}

// Persistence helper functions
function initTasksStorage() {
  try {
    const dir = path.dirname(TASKS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(TASKS_FILE)) {
      console.log(`[Storage] ${TASKS_FILE} not found. Initializing with default data...`);
      fs.writeFileSync(TASKS_FILE, JSON.stringify(DEFAULT_TASKS_DATA, null, 2), 'utf-8');
      console.log(`[Storage] ${TASKS_FILE} successfully created.`);
    } else {
      const content = fs.readFileSync(TASKS_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      const normalized = normalizeTasksData(parsed);
      fs.writeFileSync(TASKS_FILE, JSON.stringify(normalized, null, 2), 'utf-8');
      console.log(`[Storage] Verified and normalized existing ${TASKS_FILE}`);
    }
  } catch (error) {
    console.error(`[Storage Error] Initializing ${TASKS_FILE}:`, error);
  }
}

function readTasks() {
  try {
    if (!fs.existsSync(TASKS_FILE)) {
      initTasksStorage();
    }
    const data = fs.readFileSync(TASKS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return normalizeTasksData(parsed);
  } catch (error) {
    console.error(`[Storage Error] Reading ${TASKS_FILE}:`, error);
    return normalizeTasksData(DEFAULT_TASKS_DATA);
  }
}

function writeTasks(data) {
  try {
    const dir = path.dirname(TASKS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const normalized = normalizeTasksData(data);
    const content = JSON.stringify(normalized, null, 2);
    fs.writeFileSync(TASKS_FILE, content, 'utf-8');
  } catch (error) {
    console.error(`[Storage Error] Writing to ${TASKS_FILE}:`, error);
    throw error;
  }
}

// Helper: Calculate task completion status
function calculateCompletionStatus(data) {
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
    const total = child.tasks.length;
    const done = child.tasks.filter(t => t.completed).length;
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

async function syncHassEntitiesDebounced() {
  if (isSyncingHass) {
    hassSyncPending = true;
    return;
  }
  isSyncingHass = true;
  try {
    do {
      hassSyncPending = false;
      const latestData = readTasks();
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

function handleExternalParentBypassChange(isBypass) {
  try {
    const data = readTasks();
    if (!data.homeAssistant) {
      data.homeAssistant = { ...DEFAULT_HASS_CONFIG };
    }
    const currentBypass = Boolean(data.homeAssistant.parentBypass);
    if (currentBypass !== isBypass) {
      console.log(`[Home Assistant Event] Parent TV Bypass state changed in Home Assistant to: ${isBypass ? 'ON' : 'OFF'}`);
      data.homeAssistant.parentBypass = isBypass;
      writeTasks(data);
      io.emit('task_updated', data);
      syncHassEntitiesDebounced().catch(() => {});
    }
  } catch (err) {
    console.error('Failed to handle external parent bypass state change:', err);
  }
}

function startHassEventListener() {
  stopHassEventListener();

  const data = readTasks();
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
app.use(express.json());

// API Endpoint: Available Icons list
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
app.get('/api/hass/status', (req, res) => {
  try {
    const data = readTasks();
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
app.post('/api/hass/bypass', async (req, res) => {
  try {
    const data = readTasks();
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
    writeTasks(data);

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

      syncHassEntitiesDebounced().catch(() => {});
    }

    io.emit('task_updated', data);
    res.json({ success: true, parentBypass: enabled });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API Endpoints: Home Assistant Configuration & Testing & Entity Creation
app.get('/api/hass/config', (req, res) => {
  try {
    const data = readTasks();
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

app.post('/api/hass/config', async (req, res) => {
  try {
    const data = readTasks();
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

    writeTasks(data);
    io.emit('task_updated', data);

    // Automatically create and sync entities immediately in Home Assistant
    if (data.homeAssistant.enabled) {
      syncHassEntitiesDebounced().catch(() => {});
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

app.post('/api/hass/test', async (req, res) => {
  try {
    const data = readTasks();
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
app.post('/api/hass/create-entities', async (req, res) => {
  try {
    const data = readTasks();
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
app.post('/api/hass/add-card', async (req, res) => {
  try {
    const data = readTasks();
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
app.get('/api/hass/card-yaml', (req, res) => {
  try {
    const data = readTasks();
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
app.get('/api/parent/pin-status', (req, res) => {
  try {
    const data = readTasks();
    const hasPin = Boolean(data.parentPin && String(data.parentPin).trim().length >= 4);
    res.json({ success: true, hasPin });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve PIN status' });
  }
});

// Verify entered parent PIN
app.post('/api/parent/verify-pin', (req, res) => {
  try {
    const { pin } = req.body || {};
    const data = readTasks();
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
app.post('/api/parent/set-pin', (req, res) => {
  try {
    const { pin, confirmPin, currentPin } = req.body || {};
    const data = readTasks();
    const existingPin = data.parentPin ? String(data.parentPin).trim() : null;

    // If a PIN already exists, require valid currentPin
    if (existingPin && existingPin.length >= 4) {
      if (!currentPin || String(currentPin).trim() !== existingPin) {
        return res.status(401).json({ success: false, error: 'קוד ה-PIN הנוכחי אינו נכון.' });
      }
    }

    const cleanPin = String(pin || '').trim();
    const cleanConfirm = String(confirmPin || '').trim();

    if (!/^\d{4,6}$/.test(cleanPin)) {
      return res.status(400).json({ success: false, error: 'על קוד ה-PIN להכיל בין 4 ל-6 ספרות בלבד.' });
    }

    if (cleanPin !== cleanConfirm) {
      return res.status(400).json({ success: false, error: 'אימות הקוד אינו תואם לקוד שהוקלד.' });
    }

    data.parentPin = cleanPin;
    writeTasks(data);

    res.json({ success: true, message: 'קוד ה-PIN נשמר בהצלחה!' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to save PIN' });
  }
});

// API Endpoints: Tasks
app.get('/api/tasks', (req, res) => {
  try {
    const tasks = readTasks();
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve tasks' });
  }
});

app.post('/api/tasks/toggle', (req, res) => {
  const { childId, taskId, isParent } = req.body;

  if (!childId || !taskId) {
    return res.status(400).json({ error: 'childId and taskId are required' });
  }

  try {
    const data = readTasks();
    const child = data.children.find(c => c.id === childId);

    if (!child) {
      return res.status(404).json({ error: `Child with id ${childId} not found` });
    }

    const task = child.tasks.find(t => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: `Task with id ${taskId} not found for child ${childId}` });
    }

    // Children can only change from to do -> done. Only parents can revert back to pending.
    if (!isParent && task.completed) {
      return res.status(403).json({ error: 'משימה שסומנה כבוצעה ניתנת לשינוי רק על ידי ההורים' });
    }

    // Toggle completed status and timestamp
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;

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
      completedAt: task.completedAt
    };

    data.history.unshift(historyEntry);

    if (data.history.length > 2000) {
      data.history = data.history.slice(0, 2000);
    }

    // Persist directly to JSON file
    writeTasks(data);

    // Broadcast updated state to all connected clients
    io.emit('task_updated', data);

    // Automatically sync updated entities with Home Assistant & enforce TV block
    syncHassEntitiesDebounced().catch(() => {});

    res.json({ success: true, childId, taskId, completed: task.completed, completedAt: task.completedAt, icon: task.icon, data });
  } catch (error) {
    console.error('Failed to toggle task:', error);
    res.status(500).json({ error: 'Failed to toggle task' });
  }
});

// API Endpoint: Reset day's task states (keeps children, names, tasks, and history!)
app.post('/api/tasks/reset-day', (req, res) => {
  try {
    const data = readTasks();
    data.children.forEach(child => {
      child.tasks.forEach(task => {
        task.completed = false;
        task.completedAt = null;
      });
    });
    data.lastActiveDate = getTodayDateString();

    writeTasks(data);
    io.emit('task_updated', data);

    // Automatically sync reset state with Home Assistant entities
    syncHassEntitiesDebounced().catch(() => {});

    res.json({ success: true, message: 'All daily tasks have been reset', data });
  } catch (error) {
    console.error('Failed to reset daily tasks:', error);
    res.status(500).json({ error: 'Failed to reset daily tasks' });
  }
});

// API Endpoint: History retrieval
app.get('/api/history', (req, res) => {
  try {
    const data = readTasks();
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
app.post('/api/children', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Child name is required' });
  }

  try {
    const data = readTasks();
    const newChild = {
      id: `child_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim(),
      tasks: []
    };

    data.children.push(newChild);
    writeTasks(data);
    io.emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.status(201).json({ success: true, child: newChild, data });
  } catch (error) {
    console.error('Failed to add child:', error);
    res.status(500).json({ error: 'Failed to add child' });
  }
});

app.put('/api/children/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Child name is required' });
  }

  try {
    const data = readTasks();
    const child = data.children.find(c => c.id === id);
    if (!child) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    child.name = name.trim();
    writeTasks(data);
    io.emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.json({ success: true, child, data });
  } catch (error) {
    console.error('Failed to update child:', error);
    res.status(500).json({ error: 'Failed to update child' });
  }
});

app.delete('/api/children/:id', (req, res) => {
  const { id } = req.params;

  try {
    const data = readTasks();
    const childIndex = data.children.findIndex(c => c.id === id);
    if (childIndex === -1) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    const removedChild = data.children.splice(childIndex, 1)[0];
    writeTasks(data);
    io.emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.json({ success: true, removed: removedChild, data });
  } catch (error) {
    console.error('Failed to delete child:', error);
    res.status(500).json({ error: 'Failed to delete child' });
  }
});

// API Endpoints: Task Management (CRUD per child)
app.post('/api/children/:id/tasks', (req, res) => {
  const { id } = req.params;
  const { title, icon } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Task title is required' });
  }

  try {
    const data = readTasks();
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
      icon: assignedIcon
    };

    child.tasks.push(newTask);
    writeTasks(data);
    io.emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.status(201).json({ success: true, task: newTask, data });
  } catch (error) {
    console.error('Failed to add task:', error);
    res.status(500).json({ error: 'Failed to add task' });
  }
});

app.put('/api/children/:id/tasks/:taskId', (req, res) => {
  const { id, taskId } = req.params;
  const { title, icon } = req.body;

  if (!title && !icon) {
    return res.status(400).json({ error: 'title or icon is required to update task' });
  }

  try {
    const data = readTasks();
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

    writeTasks(data);
    io.emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.json({ success: true, task, data });
  } catch (error) {
    console.error('Failed to update task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/children/:id/tasks/:taskId', (req, res) => {
  const { id, taskId } = req.params;

  try {
    const data = readTasks();
    const child = data.children.find(c => c.id === id);
    if (!child) {
      return res.status(404).json({ error: `Child with id ${id} not found` });
    }

    const taskIndex = child.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      return res.status(404).json({ error: `Task with id ${taskId} not found for child ${id}` });
    }

    const removedTask = child.tasks.splice(taskIndex, 1)[0];
    writeTasks(data);
    io.emit('task_updated', data);
    createAndSyncAllHassEntities(data).catch(() => {});

    res.json({ success: true, removed: removedTask, data });
  } catch (error) {
    console.error('Failed to delete task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Reorder tasks for a child
app.post('/api/children/:id/tasks/reorder', (req, res) => {
  const { id } = req.params;
  const { taskIds } = req.body;

  if (!Array.isArray(taskIds)) {
    return res.status(400).json({ error: 'taskIds must be an array' });
  }

  try {
    const data = readTasks();
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

    writeTasks(data);
    io.emit('task_updated', data);

    res.json({ success: true, data });
  } catch (error) {
    console.error('Failed to reorder tasks:', error);
    res.status(500).json({ error: 'Failed to reorder tasks' });
  }
});

// Root Route - serves the Kids Task Board SPA
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>לוח משימות לילדים</title>
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  
  <!-- Google Fonts - Rubik for clean Hebrew typography -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  
  <style>
    body {
      font-family: 'Rubik', system-ui, -apple-system, sans-serif;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    .task-card {
      transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s ease;
    }
    .task-card:active {
      transform: scale(0.97);
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-full flex flex-col selection:bg-indigo-500 selection:text-white">

  <!-- Header Bar -->
  <header class="bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-20 px-4 sm:px-8 py-4 shadow-md">
    <div class="max-w-7xl mx-auto flex items-center justify-between gap-4">
      <div class="flex items-center space-x-3 space-x-reverse">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-indigo-900/40">
          ⭐
        </div>
        <div>
          <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
            לוח משימות יומי
          </h1>
          <p id="current-date" class="text-xs sm:text-sm text-slate-400 font-medium"></p>
        </div>
      </div>

      <!-- Navigation, TV Status Badge & Realtime Status Indicator -->
      <div class="flex items-center gap-2 sm:gap-3">
        <!-- Live TV Block Indicator -->
        <div id="tv-status-badge" class="hidden items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition">
          <!-- Injected dynamically -->
        </div>

        <button onclick="handleParentAccess(event)" class="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 shadow-sm transition">
          <span>⚙️</span>
          <span>ניהול הורים</span>
        </button>

        <button id="status-badge" onclick="reconnectSocket()" title="לחץ לחיבור מחדש" class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer hover:bg-slate-700 transition">
          <span id="status-dot" class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
          <span id="status-text" class="hidden sm:inline">מתחבר...</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Main Content Area -->
  <main class="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
    <!-- Loading Skeleton -->
    <div id="loading" class="flex flex-col items-center justify-center py-20 text-slate-400 space-y-4">
      <div class="w-12 h-12 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin"></div>
      <p class="text-lg font-medium">טוען משימות...</p>
    </div>

    <!-- Children Columns Grid -->
    <div id="board" class="hidden grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-start">
      <!-- Dynamic children cards injected here -->
    </div>
  </main>

  <!-- Tablet Toast Notification -->
  <div id="tablet-toast" class="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl bg-slate-900/95 border border-slate-700 text-white font-bold text-sm shadow-2xl transition-all duration-300 pointer-events-none opacity-0 z-50"></div>

  <!-- Footer Info -->
  <footer class="py-4 text-center text-xs text-slate-500 border-t border-slate-900">
    לוח משימות לילדים &bull; סנכרון בזמן אמת &bull; מותאם למסכי מגע &bull; <button onclick="handleParentAccess(event)" class="text-indigo-400 hover:underline bg-transparent border-0 cursor-pointer p-0 font-inherit text-xs">לוח ניהול הורים</button>
  </footer>

  <!-- PIN Modal Overlay -->
  <div id="pin-modal" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm hidden" role="dialog" aria-modal="true">
    <div id="pin-box" class="bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6 sm:p-8 w-full max-w-xs flex flex-col items-center gap-5 select-none mx-4">
      <div class="text-center">
        <div class="text-4xl mb-2">👑</div>
        <h2 class="text-xl font-black text-white" id="pin-title">כניסה להורים</h2>
        <p class="text-sm text-slate-400 mt-1" id="pin-subtitle">הזן את קוד ה-PIN (4-6 ספרות)</p>
      </div>

      <div id="pin-dots" class="flex gap-3 items-center justify-center min-h-[2.5rem]"></div>
      <p id="pin-error" class="text-rose-400 text-sm font-bold text-center hidden min-h-[1.25rem]"></p>

      <div class="grid grid-cols-3 gap-3 w-full">
        <button class="pin-key" data-digit="1">1</button>
        <button class="pin-key" data-digit="2">2</button>
        <button class="pin-key" data-digit="3">3</button>
        <button class="pin-key" data-digit="4">4</button>
        <button class="pin-key" data-digit="5">5</button>
        <button class="pin-key" data-digit="6">6</button>
        <button class="pin-key" data-digit="7">7</button>
        <button class="pin-key" data-digit="8">8</button>
        <button class="pin-key" data-digit="9">9</button>
        <button id="pin-cancel-btn" class="pin-key pin-key-secondary text-sm">ביטול</button>
        <button class="pin-key" data-digit="0">0</button>
        <button id="pin-del-btn" class="pin-key pin-key-del">⌫</button>
      </div>
    </div>
  </div>

  <style>
    .pin-key {
      height: 64px; border-radius: 16px; font-size: 1.5rem; font-weight: 800;
      color: #fff; background: #1e293b; border: 1px solid #334155;
      transition: background 0.1s, transform 0.08s; touch-action: manipulation;
      cursor: pointer; display: flex; align-items: center; justify-content: center; width: 100%;
    }
    .pin-key:active, .pin-key:focus-visible { background: #3730a3; transform: scale(0.93); outline: none; }
    .pin-key-secondary { font-size: 0.85rem; background: #334155; }
    .pin-key-del { font-size: 1.3rem; background: #450a0a; border-color: #7f1d1d; }
    @keyframes pinShake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-10px)} 60%{transform:translateX(10px)} 80%{transform:translateX(-6px)} }
    .pin-shake { animation: pinShake 0.38s ease; }
  </style>

  <!-- Socket.io client script served automatically by socket.io server -->
  <script src="/socket.io/socket.io.js"></script>

  <script>
    try {
      const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      const hebrewDate = new Intl.DateTimeFormat('he-IL', options).format(new Date());
      document.getElementById('current-date').innerText = hebrewDate;
    } catch (e) {
      document.getElementById('current-date').innerText = new Date().toLocaleDateString('he-IL');
    }

    const statusBadge = document.getElementById('status-badge');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const loadingElem = document.getElementById('loading');
    const boardElem = document.getElementById('board');
    const tvStatusBadge = document.getElementById('tv-status-badge');

    const childColors = [
      { bg: 'from-blue-600 to-indigo-700', text: 'text-indigo-200', border: 'border-indigo-500/30' },
      { bg: 'from-purple-600 to-pink-700', text: 'text-pink-200', border: 'border-pink-500/30' },
      { bg: 'from-amber-600 to-orange-700', text: 'text-amber-200', border: 'border-amber-500/30' },
      { bg: 'from-emerald-600 to-teal-700', text: 'text-teal-200', border: 'border-teal-500/30' }
    ];

    let currentData = null;
    let pendingToggles = new Set();

    function formatTime(isoString) {
      if (!isoString) return '';
      try {
        const d = new Date(isoString);
        return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return '';
      }
    }

    function updateConnectionStatus(isConnected) {
      if (isConnected) {
        statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50';
        statusText.innerText = 'מחובר בזמן אמת';
        statusBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-950/60 border border-emerald-800/60 text-emerald-300';
      } else {
        statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse';
        statusText.innerText = 'מנותק - מתחבר...';
        statusBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-950/60 border border-rose-800/60 text-rose-300';
      }
    }

    function updateTvBadge(data) {
      if (!data.homeAssistant || !data.homeAssistant.enabled) {
        tvStatusBadge.classList.add('hidden');
        tvStatusBadge.classList.remove('flex');
        return;
      }

      let total = 0;
      let completed = 0;
      data.children.forEach(c => {
        total += c.tasks.length;
        completed += c.tasks.filter(t => t.completed).length;
      });
      const allDone = total > 0 && completed === total;
      const isBypass = Boolean(data.homeAssistant && data.homeAssistant.parentBypass);

      tvStatusBadge.classList.remove('hidden');
      tvStatusBadge.classList.add('flex');

      if (allDone) {
        tvStatusBadge.className = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 shadow-sm animate-pulse';
        tvStatusBadge.innerHTML = '<span>📺</span><span>טלוויזיה מותרת! 🎉</span>';
      } else if (isBypass) {
        tvStatusBadge.className = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-purple-950/80 border border-purple-700/80 text-purple-300 shadow-sm animate-pulse';
        tvStatusBadge.innerHTML = '<span>🔓</span><span>טלוויזיה מותרת (מעקף הורים)</span>';
      } else {
        tvStatusBadge.className = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-rose-950/80 border border-rose-800/80 text-rose-300 shadow-sm';
        tvStatusBadge.innerHTML = '<span>🔒</span><span>טלוויזיה חסומה (' + (total - completed) + ' נותרו)</span>';
      }
    }

    function renderBoard(data) {
      currentData = data;
      loadingElem.classList.add('hidden');
      boardElem.classList.remove('hidden');
      updateTvBadge(data);

      if (!data || !data.children || data.children.length === 0) {
        boardElem.innerHTML = \`
          <div class="col-span-full text-center py-16 bg-slate-900/60 rounded-3xl border border-slate-800">
            <p class="text-slate-400 text-xl font-bold mb-3">עדיין לא הוגדרו ילדים בלוח</p>
            <a href="/parent" class="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg transition">
              עבור ללוח ניהול הורים להוספת ילדים
            </a>
          </div>\`;
        return;
      }

      boardElem.innerHTML = data.children.map((child, index) => {
        const theme = childColors[index % childColors.length];
        const total = child.tasks.length;
        const completed = child.tasks.filter(t => t.completed).length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        const isAllDone = total > 0 && completed === total;

        return \`
          <section class="bg-slate-900/90 rounded-3xl border border-slate-800 p-5 sm:p-7 shadow-2xl flex flex-col gap-6 relative overflow-hidden transition-all duration-200">
            <!-- Header for child -->
            <div class="flex items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
              <div class="flex items-center gap-4">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr \${theme.bg} flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-black/40 border \${theme.border}">
                  \${child.name.charAt(0)}
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <h2 class="text-2xl sm:text-3xl font-extrabold text-white tracking-wide">\${child.name}</h2>
                    \${isAllDone ? '<span class="text-xl animate-bounce" title="כל הכבוד!">🎉</span>' : ''}
                  </div>
                  <p class="text-sm font-medium text-slate-400 mt-0.5">
                    \${completed} מתוך \${total} משימות בוצעו
                  </p>
                </div>
              </div>

              <!-- Progress Badge -->
              <div class="text-left flex flex-col items-end">
                <span class="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full \${isAllDone ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}">
                  \${percentage}%
                </span>
              </div>
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-slate-800/80 h-3.5 rounded-full overflow-hidden p-0.5 border border-slate-700/50">
              <div class="h-full rounded-full transition-all duration-500 ease-out \${isAllDone ? 'bg-gradient-to-l from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/50' : 'bg-gradient-to-l from-indigo-500 to-indigo-400'}"
                   style="width: \${percentage}%"></div>
            </div>

            <!-- Tasks List with Icons -->
            <div class="flex flex-col gap-3.5" role="list">
              \${child.tasks.length === 0 ? '<p class="text-slate-500 text-center py-6">אין משימות מוגדרות לילד זה</p>' : child.tasks.map(task => {
                const isCompleted = task.completed;
                const cardBg = isCompleted ? 'bg-emerald-600' : 'bg-rose-700';
                const cardHover = isCompleted ? 'hover:bg-emerald-600' : 'hover:bg-rose-600';
                const statusText = isCompleted ? 'בוצע ✔ 🔒' : 'טרם בוצע ❌';
                const badgeStyle = isCompleted ? 'bg-emerald-800/70 border-emerald-400/40 text-emerald-100' : 'bg-rose-900/70 border-rose-400/40 text-rose-100';
                const completedTimeStr = isCompleted && task.completedAt ? formatTime(task.completedAt) : '';
                const taskIcon = task.icon || 'star';
                const interactiveClasses = isCompleted ? 'cursor-default opacity-95' : 'cursor-pointer active:scale-[0.98]';

                return \`
                  <button 
                    type="button"
                    onclick="toggleTask('\${child.id}', '\${task.id}')"
                    class="task-card w-full text-right p-4 sm:p-5 rounded-2xl \${cardBg} \${cardHover} text-white shadow-lg \${interactiveClasses} flex items-center justify-between gap-4 border border-white/10 focus:outline-none focus:ring-4 focus:ring-indigo-400/50 transition-all select-none"
                    aria-pressed="\${isCompleted}"
                    data-child-id="\${child.id}"
                    data-task-id="\${task.id}"
                  >
                    <div class="flex items-center gap-3.5 min-w-0">
                      <div class="w-12 h-12 rounded-2xl bg-black/25 p-1.5 flex items-center justify-center flex-shrink-0 border border-white/10 shadow-sm">
                        \${taskIcon === 'none' ? '' : \`<img 
                          src="/icons/\${taskIcon}.svg" 
                          alt="\${task.title}" 
                          class="w-full h-full object-contain filter drop-shadow"
                          onerror="this.onerror=null; this.remove();"
                        >\`}
                      </div>
                      <div class="flex flex-col min-w-0">
                        <span class="text-lg sm:text-xl font-bold tracking-tight truncate leading-tight \${isCompleted ? 'line-through decoration-white/60 text-white/90' : 'text-white'}">
                          \${task.title}
                        </span>
                        \${completedTimeStr ? \`<span class="text-xs text-emerald-200/90 mt-0.5">הושלם בשעה \${completedTimeStr}</span>\` : ''}
                      </div>
                    </div>

                    <span class="flex-shrink-0 px-3.5 py-1.5 text-sm sm:text-base font-bold rounded-xl border shadow-inner \${badgeStyle}">
                      \${statusText}
                    </span>
                  </button>
                \`;
              }).join('')}
            </div>
          </section>
        \`;
      }).join('');
    }

    function showToast(msg) {
      const el = document.getElementById('tablet-toast');
      if (!el) return;
      el.innerText = msg;
      el.classList.remove('opacity-0');
      el.classList.add('opacity-100');
      setTimeout(() => {
        el.classList.remove('opacity-100');
        el.classList.add('opacity-0');
      }, 2500);
    }

    async function toggleTask(childId, taskId) {
      if (currentData) {
        const child = currentData.children.find(c => c.id === childId);
        if (child) {
          const task = child.tasks.find(t => t.id === taskId);
          if (task && task.completed) {
            showToast('המשימה כבר בוצעה! רק הורים יכולים לבטל משימה שבוצעה 🔒');
            return;
          }
        }
      }

      const toggleKey = \`\${childId}_\${taskId}\`;
      if (pendingToggles.has(toggleKey)) return;
      pendingToggles.add(toggleKey);

      if (currentData) {
        const child = currentData.children.find(c => c.id === childId);
        if (child) {
          const task = child.tasks.find(t => t.id === taskId);
          if (task) {
            task.completed = true;
            task.completedAt = new Date().toISOString();
            renderBoard(currentData);
          }
        }
      }

      try {
        const response = await fetch('/api/tasks/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ childId, taskId, isParent: false })
        });

        if (!response.ok) {
          throw new Error('Toggle request failed with status ' + response.status);
        }
      } catch (err) {
        console.error('Error toggling task:', err);
        fetchTasks();
      } finally {
        setTimeout(() => {
          pendingToggles.delete(toggleKey);
        }, 300);
      }
    }

    async function fetchTasks() {
      try {
        const res = await fetch('/api/tasks');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderBoard(data);
      } catch (err) {
        console.error('Failed to load tasks:', err);
        loadingElem.innerHTML = '<p class="text-rose-400 font-bold text-lg">שגיאה בטעינת המשימות. נא לטעון מחדש.</p>';
      }
    }

    const socket = io({
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity
    });

    socket.on('connect', () => {
      updateConnectionStatus(true);
    });

    socket.on('disconnect', () => {
      updateConnectionStatus(false);
    });

    socket.on('task_updated', (updatedData) => {
      renderBoard(updatedData);
    });

    function reconnectSocket() {
      fetchTasks();
      if (!socket.connected) {
        socket.connect();
      }
    }

    // Pull-to-refresh: swipe down from top → hard reload
    (function initPullToRefresh() {
      let startY = 0;
      let pulling = false;
      const THRESHOLD = 120;

      document.addEventListener('touchstart', e => {
        if (window.scrollY === 0) {
          startY = e.touches[0].clientY;
          pulling = true;
        }
      }, { passive: true });

      document.addEventListener('touchmove', e => {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 10 && window.scrollY === 0) {
          document.body.style.transition = 'transform 0.1s';
          document.body.style.transform = \`translateY(\${Math.min(dy * 0.4, 60)}px)\`;
        }
      }, { passive: true });

      document.addEventListener('touchend', e => {
        if (!pulling) return;
        const dy = e.changedTouches[0].clientY - startY;
        document.body.style.transition = 'transform 0.2s';
        document.body.style.transform = '';
        if (dy >= THRESHOLD && window.scrollY === 0) {
          location.reload();
        }
        pulling = false;
      }, { passive: true });
    })();

    fetchTasks();

    // ==========================================
    // Parent PIN Access Logic
    // ==========================================
    (function initPinModal() {
      const modal = document.getElementById('pin-modal');
      const pinBox = document.getElementById('pin-box');
      const pinTitle = document.getElementById('pin-title');
      const pinSubtitle = document.getElementById('pin-subtitle');
      const pinDots = document.getElementById('pin-dots');
      const pinError = document.getElementById('pin-error');
      const cancelBtn = document.getElementById('pin-cancel-btn');
      const delBtn = document.getElementById('pin-del-btn');

      // Mode: 'verify' | 'setup_enter' | 'setup_confirm'
      let pinMode = 'verify';
      let currentPin = '';
      let firstPin = '';   // preserved across resetModal when transitioning to setup_confirm
      const MIN_PIN = 4;
      const MAX_PIN = 6;

      // Number of dots to display = firstPin.length when in confirm mode, else MAX_PIN
      function getDotsCount() {
        return (pinMode === 'setup_confirm' && firstPin.length >= MIN_PIN) ? firstPin.length : MAX_PIN;
      }

      function renderDots(len) {
        const total = getDotsCount();
        pinDots.innerHTML = Array.from({ length: total }, (_, i) =>
          \`<div class="w-4 h-4 rounded-full border-2 transition-all duration-150 \${i < len ? 'bg-indigo-400 border-indigo-400 scale-110' : 'bg-transparent border-slate-600'}"></div>\`
        ).join('');
      }

      function showError(msg) {
        pinError.textContent = msg;
        pinError.classList.remove('hidden');
        pinBox.classList.add('pin-shake');
        setTimeout(() => pinBox.classList.remove('pin-shake'), 400);
      }

      function clearError() {
        pinError.classList.add('hidden');
        pinError.textContent = '';
      }

      // resetModal: preserveFirstPin prevents wiping firstPin when transitioning to setup_confirm
      function resetModal(mode, preserveFirstPin) {
        pinMode = mode;
        currentPin = '';
        if (!preserveFirstPin) firstPin = '';
        clearError();
        if (mode === 'verify') {
          pinTitle.textContent = 'כניסה להורים';
          pinSubtitle.textContent = 'הזן את קוד ה-PIN';
          cancelBtn.textContent = 'ביטול';
        } else if (mode === 'setup_enter') {
          pinTitle.textContent = '🔐 הגדרת קוד גישה';
          pinSubtitle.textContent = 'בחר קוד PIN חדש (4-6 ספרות)';
          cancelBtn.textContent = 'ביטול';
        } else if (mode === 'setup_confirm') {
          pinTitle.textContent = '✅ אמת את הקוד';
          pinSubtitle.textContent = \`הזן שוב את הקוד (\${firstPin.length} ספרות)\`;
          cancelBtn.textContent = 'התחל מחדש';
        }
        renderDots(0);
      }

      function closeModal() {
        modal.classList.add('hidden');
        currentPin = '';
        firstPin = '';
        clearError();
      }

      async function submitPin() {
        if (pinMode === 'verify') {
          if (currentPin.length < MIN_PIN) {
            showError('קוד ה-PIN חייב להכיל לפחות 4 ספרות');
            return;
          }
          try {
            const res = await fetch('/api/parent/verify-pin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pin: currentPin })
            });
            const data = await res.json();
            if (data.success) {
              sessionStorage.setItem('kids_tasker_parent_unlocked', '1');
              closeModal();
              window.location.href = '/parent';
            } else {
              showError(data.error || 'קוד שגוי, נסה שוב');
              currentPin = '';
              renderDots(0);
            }
          } catch (e) {
            showError('שגיאת תקשורת, נסה שוב');
          }
        } else if (pinMode === 'setup_enter') {
          if (currentPin.length < MIN_PIN) { showError('יש להזין לפחות 4 ספרות'); return; }
          firstPin = currentPin;                         // save first entry
          resetModal('setup_confirm', true);             // true = preserve firstPin
        } else if (pinMode === 'setup_confirm') {
          if (currentPin !== firstPin) {
            showError('הקודים אינם תואמים – התחל מחדש');
            setTimeout(() => resetModal('setup_enter'), 1400);
            return;
          }
          try {
            const res = await fetch('/api/parent/set-pin', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pin: currentPin, confirmPin: currentPin })
            });
            const data = await res.json();
            if (data.success) {
              sessionStorage.setItem('kids_tasker_parent_unlocked', '1');
              closeModal();
              window.location.href = '/parent';
            } else {
              showError(data.error || 'שגיאה בשמירת הקוד');
            }
          } catch (e) {
            showError('שגיאת תקשורת, נסה שוב');
          }
        }
      }

      function onDigit(d) {
        const limit = (pinMode === 'setup_confirm' && firstPin.length >= MIN_PIN) ? firstPin.length : MAX_PIN;
        if (currentPin.length >= limit) return;
        currentPin += d;
        clearError();
        renderDots(currentPin.length);
        // Auto-submit when we reach the expected length
        if (currentPin.length === limit && (pinMode === 'verify' || pinMode === 'setup_confirm')) {
          setTimeout(submitPin, 120);
        }
        // In setup_enter auto-submit only at MAX_PIN; shorter PINs need Enter or confirm btn
      }

      function onDelete() {
        currentPin = currentPin.slice(0, -1);
        clearError();
        renderDots(currentPin.length);
      }

      // Cancel button: close in verify/setup_enter, restart in setup_confirm
      cancelBtn.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (pinMode === 'setup_confirm') {
          resetModal('setup_enter');
        } else {
          closeModal();
        }
      });

      // Wire digit buttons
      document.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
        btn.addEventListener('pointerdown', e => { e.preventDefault(); onDigit(btn.dataset.digit); });
      });
      delBtn.addEventListener('pointerdown', e => { e.preventDefault(); onDelete(); });

      // Physical keyboard support
      document.addEventListener('keydown', e => {
        if (modal.classList.contains('hidden')) return;
        if (e.key >= '0' && e.key <= '9') { e.preventDefault(); onDigit(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); onDelete(); }
        else if (e.key === 'Enter') { e.preventDefault(); submitPin(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      });

      // Close on backdrop click
      modal.addEventListener('pointerdown', e => { if (e.target === modal) closeModal(); });

      // Expose open function globally
      window.openPinModal = async function() {
        try {
          const res = await fetch('/api/parent/pin-status');
          const data = await res.json();
          resetModal(data.hasPin ? 'verify' : 'setup_enter');
        } catch(e) {
          resetModal('setup_enter');
        }
        modal.classList.remove('hidden');
        renderDots(0);
      };
    })();

    window.handleParentAccess = function(e) {
      if (e) e.preventDefault();
      window.openPinModal();
    };
  </script>
</body>
</html>`);
});

// Parent Management Dashboard Route
app.get('/parent', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>לוח ניהול הורים - משימות ילדים</title>
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  
  <!-- Google Fonts Rubik -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  
  <style>
    body {
      font-family: 'Rubik', system-ui, -apple-system, sans-serif;
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-full flex flex-col selection:bg-indigo-500 selection:text-white">

  <!-- PIN Lock Overlay (shown if direct navigation without PIN) -->
  <div id="parent-pin-overlay" class="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/98 backdrop-blur-sm hidden">
    <div id="parent-pin-box" class="bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6 sm:p-8 w-full max-w-xs flex flex-col items-center gap-5 select-none mx-4">
      <div class="text-center">
        <div class="text-4xl mb-2">🔒</div>
        <h2 class="text-xl font-black text-white" id="pparent-pin-title">הזן קוד הורים</h2>
        <p class="text-sm text-slate-400 mt-1" id="pparent-pin-subtitle">הכנס קוד PIN לגישה ללוח</p>
      </div>
      <div id="pparent-pin-dots" class="flex gap-3 items-center justify-center min-h-[2.5rem]"></div>
      <p id="pparent-pin-error" class="text-rose-400 text-sm font-bold text-center hidden"></p>
      <div class="grid grid-cols-3 gap-3 w-full">
        <button class="pparent-pin-key" data-digit="1">1</button>
        <button class="pparent-pin-key" data-digit="2">2</button>
        <button class="pparent-pin-key" data-digit="3">3</button>
        <button class="pparent-pin-key" data-digit="4">4</button>
        <button class="pparent-pin-key" data-digit="5">5</button>
        <button class="pparent-pin-key" data-digit="6">6</button>
        <button class="pparent-pin-key" data-digit="7">7</button>
        <button class="pparent-pin-key" data-digit="8">8</button>
        <button class="pparent-pin-key" data-digit="9">9</button>
        <a href="/" class="pparent-pin-key pparent-pin-secondary text-sm flex items-center justify-center no-underline">← חזור</a>
        <button class="pparent-pin-key" data-digit="0">0</button>
        <button id="pparent-pin-del" class="pparent-pin-key pparent-pin-del">⌫</button>
      </div>
    </div>
  </div>

  <style>
    .pparent-pin-key {
      height: 64px; border-radius: 16px; font-size: 1.5rem; font-weight: 800;
      color: #fff; background: #1e293b; border: 1px solid #334155;
      transition: background 0.1s, transform 0.08s; touch-action: manipulation;
      cursor: pointer; display: flex; align-items: center; justify-content: center; width: 100%;
    }
    .pparent-pin-key:active, .pparent-pin-key:focus-visible { background: #3730a3; transform: scale(0.93); outline: none; }
    .pparent-pin-secondary { font-size: 0.85rem; background: #334155; text-decoration: none; }
    .pparent-pin-del { font-size: 1.3rem; background: #450a0a; border-color: #7f1d1d; }
    @keyframes pparentShake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-10px)} 60%{transform:translateX(10px)} 80%{transform:translateX(-6px)} }
    .pparent-shake { animation: pparentShake 0.38s ease; }
  </style>

  <!-- Header -->
  <header class="bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-30 px-4 sm:px-8 py-4 shadow-md">
    <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center space-x-3 space-x-reverse">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-2xl shadow-lg shadow-indigo-900/30">
          👑
        </div>
        <div>
          <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
            לוח ניהול הורים
          </h1>
          <p class="text-xs sm:text-sm text-slate-400 font-medium">מעקב, עריכת ילדים ומשימות, היסטוריה ואינטגרציית בית חכם</p>
        </div>
      </div>

      <div class="flex items-center gap-2 sm:gap-3">
        <button onclick="confirmResetDay()" class="px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-amber-600/80 hover:bg-amber-600 text-white border border-amber-500/50 shadow-sm transition flex items-center gap-1.5" title="איפוס משימות להיום בלבד - שומר את כל שמות הילדים וההיסטוריה!">
          <span>🔄</span>
          <span>איפוס ליום חדש</span>
        </button>

        <a href="/" class="px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500/50 shadow-sm transition flex items-center gap-1.5">
          <span>📱</span>
          <span>לוח ילדים (טאבלט)</span>
        </a>

        <button onclick="lockParentDashboard()" class="px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 shadow-sm transition flex items-center gap-1.5" title="נעל את לוח ההורים">
          <span>🔒</span>
          <span class="hidden sm:inline">נעל</span>
        </button>

        <button id="status-badge" onclick="reconnectSocket()" title="לחץ לחיבור מחדש" class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer hover:bg-slate-700 transition">
          <span id="status-dot" class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
          <span id="status-text" class="hidden sm:inline">מתחבר...</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Navigation Tabs -->
  <div class="bg-slate-900 border-b border-slate-800 px-4 sm:px-8">
    <div class="max-w-7xl mx-auto flex gap-2 sm:gap-4 overflow-x-auto py-2">
      <button onclick="switchTab('status')" id="tab-btn-status" class="px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-indigo-600 text-white shadow-md">
        <span>📊</span>
        <span>סטטוס משימות היום</span>
      </button>
      <button onclick="switchTab('manage')" id="tab-btn-manage" class="px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-slate-800/80 text-slate-300 hover:bg-slate-800">
        <span>✏️</span>
        <span>ניהול ילדים ומשימות</span>
      </button>
      <button onclick="switchTab('history')" id="tab-btn-history" class="px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-slate-800/80 text-slate-300 hover:bg-slate-800">
        <span>📅</span>
        <span>היסטוריית משימות</span>
      </button>
      <button onclick="switchTab('hass')" id="tab-btn-hass" class="px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-slate-800/80 text-slate-300 hover:bg-slate-800">
        <span>🏠</span>
        <span>בית חכם (Home Assistant)</span>
      </button>
    </div>
  </div>

  <!-- Main Content -->
  <main class="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">

    <!-- TAB 1: Live Status & Today's Summary -->
    <section id="tab-status" class="space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 class="text-2xl font-black text-white">סטטוס משימות יומי</h2>
          <p class="text-sm text-slate-400" id="status-current-date"></p>
        </div>
        <div id="overall-stats" class="flex gap-3">
          <!-- Injected dynamically -->
        </div>
      </div>

      <div id="status-cards-container" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Injected dynamically -->
      </div>
    </section>

    <!-- TAB 2: Manage Children and Tasks -->
    <section id="tab-manage" class="hidden space-y-8">
      <!-- Add Child Card -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <h3 class="text-xl font-black text-white mb-4 flex items-center gap-2">
          <span>➕</span>
          <span>הוספת ילד/ה חדש/ה</span>
        </h3>
        <form onsubmit="handleCreateChild(event)" class="flex flex-wrap sm:flex-nowrap gap-3">
          <input 
            type="text" 
            id="new-child-name" 
            placeholder="שם הילד/ה (לדוגמה: איתמר)" 
            required
            class="flex-1 px-4 py-3 bg-slate-950 border border-slate-700 rounded-2xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
          >
          <button type="submit" class="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl shadow-lg transition whitespace-nowrap">
            הוסף ילד/ה
          </button>
        </form>
      </div>

      <!-- List of Children with their Tasks -->
      <div id="children-manage-container" class="space-y-6">
        <!-- Injected dynamically -->
      </div>
    </section>

    <!-- TAB 3: History & Completion Logs -->
    <section id="tab-history" class="hidden space-y-6">
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-white">היסטוריית משימות</h2>
          <p class="text-sm text-slate-400">צפייה בביצועי משימות ושעות השלמה של הילדים לפי ימים</p>
        </div>

        <div class="flex items-center gap-3">
          <label for="history-date-select" class="text-sm font-bold text-slate-300">בחר תאריך:</label>
          <select id="history-date-select" onchange="loadHistory(this.value)" class="px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <!-- Injected dynamically -->
          </select>
          <button onclick="loadHistory(document.getElementById('history-date-select').value)" class="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold text-sm border border-slate-700 transition">
            רענן 🔄
          </button>
        </div>
      </div>

      <!-- History Summary for Selected Date -->
      <div id="history-summary-container" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- Injected dynamically -->
      </div>

      <!-- History Table / Activity Timeline -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <h3 class="text-xl font-black text-white mb-4 flex items-center gap-2">
          <span>📜</span>
          <span>יומן פעילות ליום הנבחר</span>
        </h3>
        <div class="overflow-x-auto">
          <table class="w-full text-right border-collapse text-sm">
            <thead>
              <tr class="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider font-bold">
                <th class="py-3 px-4">שעה</th>
                <th class="py-3 px-4">ילד/ה</th>
                <th class="py-3 px-4">אייקון ומשימה</th>
                <th class="py-3 px-4">סטטוס פעולה</th>
              </tr>
            </thead>
            <tbody id="history-table-body" class="divide-y divide-slate-800/60 font-medium">
              <!-- Injected dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TAB 4: Home Assistant (Hass.io) Integration -->
    <section id="tab-hass" class="hidden space-y-8">
      <!-- Overview Banner -->
      <div class="bg-gradient-to-r from-blue-900/50 to-indigo-900/50 border border-indigo-700/40 rounded-3xl p-6 shadow-xl flex items-start gap-4">
        <div class="text-4xl p-3 bg-indigo-600/30 rounded-2xl border border-indigo-500/30">
          📺
        </div>
        <div>
          <h2 class="text-2xl font-black text-white">אינטגרציית Home Assistant ויצירת ישויות אוטומטית</h2>
          <p class="text-sm text-slate-300 mt-1 leading-relaxed">
            המערכת מייצרת ומעדכנת ישויות ישירות ב-Home Assistant (ללא צורך בהגדרה ידנית ב-Hass.io).
            הישות הראשית <code class="bg-indigo-950/80 px-2 py-0.5 rounded text-indigo-300 font-mono">binary_sensor.kids_tasks_allow_tv</code> מסמנת האם מותר להדליק טלוויזיה!
          </p>
        </div>
      </div>

      <!-- Automatically Created Entities Live Box -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 class="text-xl font-black text-white flex items-center gap-2">
              <span>✨</span>
              <span>ישויות שנוצרות ומסונכרנות אוטומטית ב-Home Assistant</span>
            </h3>
            <p class="text-xs text-slate-400 mt-1">Kids Tasker מייצר ישויות אלו ישירות ב-Home Assistant ומתעדכן בזמן אמת עם כל משימה שמבוצעת</p>
          </div>
          <button onclick="handleCreateHassEntities()" id="btn-create-entities" class="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5">
            <span>⚡ צור / רענן ישויות עכשיו</span>
          </button>
        </div>

        <div id="hass-entities-list" class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          <!-- Injected dynamically or preview -->
          <div class="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div>
              <div class="font-bold text-sm text-white">binary_sensor.kids_tasks_allow_tv</div>
              <div class="text-xs text-slate-400">אישור צפייה בטלוויזיה (on=מותר, off=חסום)</div>
            </div>
            <span class="px-2.5 py-1 text-xs font-bold rounded-lg bg-indigo-950 text-indigo-300 border border-indigo-800">ראשי</span>
          </div>

          <div class="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div>
              <div class="font-bold text-sm text-white">binary_sensor.kids_tasks_completed</div>
              <div class="text-xs text-slate-400">האם כל המשימות של כל הילדים הושלמו</div>
            </div>
            <span class="px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-800 text-slate-300">חיישן</span>
          </div>

          <div class="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div>
              <div class="font-bold text-sm text-white">sensor.kids_tasks_remaining</div>
              <div class="text-xs text-slate-400">מספר המשימות שנותרו לביצוע</div>
            </div>
            <span class="px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-800 text-slate-300">מונה</span>
          </div>

          <div class="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div>
              <div class="font-bold text-sm text-white">sensor.kids_tasks_percentage</div>
              <div class="text-xs text-slate-400">אחוז ביצוע המשימות הכללי (0-100%)</div>
            </div>
            <span class="px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-800 text-slate-300">מדד</span>
          </div>
        </div>

        <div id="hass-entities-feedback" class="hidden p-3 rounded-xl text-xs font-bold bg-emerald-950 border border-emerald-700 text-emerald-300">
          <!-- Dynamic feedback -->
        </div>
      </div>

      <!-- Parent Bypass Quick Control -->
      <div class="bg-gradient-to-r from-purple-950/70 to-slate-900 border border-purple-800/60 rounded-3xl p-6 sm:p-8 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-2xl flex-shrink-0">
            🔓
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-lg sm:text-xl font-black text-white">מעקף הורים לטלוויזיה (Parent TV Bypass)</h3>
              <span id="bypass-badge" class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400">כבוי</span>
            </div>
            <p class="text-xs text-slate-300 mt-1">פתיחת הטלוויזיה לצפייה גם אם הילדים טרם השלימו משימות. מסנכרן ישירות עם <code class="text-purple-300 font-mono">input_boolean.kids_tasks_parent_bypass</code> ב-Home Assistant</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <button onclick="handleToggleBypass()" id="btn-toggle-bypass" type="button" class="px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white">
            <span>🔓 הפעל מעקף עכשיו</span>
          </button>
        </div>
      </div>

      <!-- Configuration Form -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <h3 class="text-xl font-black text-white flex items-center gap-2">
          <span>⚙️</span>
          <span>הגדרות חיבור ל-Home Assistant</span>
        </h3>

        <form onsubmit="handleSaveHassConfig(event)" class="space-y-6">
          <div class="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-slate-800">
            <div>
              <label for="hass-enabled" class="font-bold text-base text-white block cursor-pointer">הפעל אינטגרציה עם Home Assistant</label>
              <span class="text-xs text-slate-400">הפעלת יצירת ישויות אוטומטית וחסימת טלוויזיה</span>
            </div>
            <input type="checkbox" id="hass-enabled" class="w-6 h-6 rounded-lg accent-indigo-600 cursor-pointer">
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-bold text-slate-300 mb-2">כתובת שרת Home Assistant (URL)</label>
              <input 
                type="text" 
                id="hass-url" 
                placeholder="http://homeassistant.local:8123 או http://192.168.1.100:8123" 
                class="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
              <span class="text-xs text-slate-500 mt-1 block">כולל פורט :8123</span>
            </div>

            <div>
              <label class="block text-sm font-bold text-slate-300 mb-2">טוקן גישה לטווח ארוך (Long-Lived Access Token)</label>
              <input 
                type="password" 
                id="hass-token" 
                placeholder="הדבק טוקן גישה מ-Home Assistant..." 
                class="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
              <span class="text-xs text-slate-500 mt-1 block">נוצר בפרופיל המשתמש ב-Home Assistant (תחת Security)</span>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-800">
            <div>
              <label class="block text-sm font-bold text-slate-300 mb-2">ישות הטלוויזיה / השקע החכם (Entity ID - אופציונלי לחסימה ישירה)</label>
              <input 
                type="text" 
                id="hass-tv-entity" 
                placeholder="למשל: switch.living_room_tv_socket או media_player.tv" 
                class="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
              <span class="text-xs text-slate-500 mt-1 block">אם מוגדר, השרת יכבה ישות זו ישירות כל עוד המשימות לא הושלמו</span>
            </div>

            <div class="flex flex-col justify-center">
              <label class="flex items-center gap-3 p-4 bg-slate-950 rounded-2xl border border-slate-800 cursor-pointer">
                <input type="checkbox" id="hass-auto-block" class="w-5 h-5 rounded accent-rose-600 cursor-pointer">
                <div>
                  <span class="font-bold text-sm text-white block">חסימת טלוויזיה אוטומטית פעילה</span>
                  <span class="text-xs text-slate-400">כיבוי מיידי של הטלוויזיה אם היא מודלקת לפני סיום המשימות</span>
                </div>
              </label>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-800">
            <div class="flex items-center gap-3">
              <button type="submit" class="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl shadow-lg transition flex items-center gap-2">
                <span>שמור הגדרות</span>
                <span>💾</span>
              </button>
              <span id="hass-save-feedback" class="text-sm font-bold text-emerald-400 hidden">✓ ההגדרות נשמרו בהצלחה!</span>
            </div>

            <button type="button" onclick="handleTestHass()" id="btn-test-hass" class="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-2xl border border-slate-700 transition flex items-center gap-2">
              <span>בדוק חיבור 📡</span>
            </button>
          </div>
        </form>

        <div id="hass-test-result" class="hidden p-4 rounded-2xl border text-sm font-medium"></div>
      </div>

      <!-- Home Assistant Lovelace Card (Automatic & Copy YAML) -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 class="text-xl font-black text-white flex items-center gap-2">
              <span>🎴</span>
              <span>כרטיס לוח בקרה ל-Home Assistant (Lovelace Card)</span>
            </h3>
            <p class="text-xs text-slate-400 mt-1">כרטיס מעוצב המרכז את כל ישויות המשימות, אישור הטלוויזיה והילדים בתצוגה אחת</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button onclick="handleAddLovelaceCard()" id="btn-add-lovelace-card" class="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-2">
              <span>➕ הוסף כרטיס ל-Home Assistant בלחיצה אחת</span>
            </button>
            <button onclick="handleCopyCardYaml()" id="btn-copy-card-yaml" class="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 transition flex items-center gap-1.5">
              <span>📋 העתק קוד כרטיס (YAML)</span>
            </button>
          </div>
        </div>

        <!-- Live Card Action Feedback -->
        <div id="hass-card-feedback" class="hidden p-4 rounded-2xl border text-sm font-medium"></div>

        <!-- Visual Preview & YAML Code -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Live Visual Preview of Card -->
          <div class="space-y-2">
            <div class="text-xs font-bold text-slate-400 flex items-center gap-1.5">
              <span>👁️</span>
              <span>תצוגה מקדימה של הכרטיס ב-Home Assistant:</span>
            </div>
            <div class="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-inner">
              <div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <div class="font-black text-base text-white flex items-center gap-2">
                  <span>📋</span>
                  <span>לוח משימות לילדים (Kids Tasker)</span>
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-950 text-indigo-300 border border-indigo-800/60">Lovelace</span>
              </div>

              <!-- Entities Preview Rows -->
              <div class="space-y-2 text-xs">
                <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/80 border border-slate-800/50">
                  <div class="flex items-center gap-2 text-slate-300">
                    <span class="text-base">📺</span>
                    <span class="font-medium">אישור צפייה בטלוויזיה</span>
                  </div>
                  <span id="preview-tv-allow" class="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-800 text-slate-300">טוען...</span>
                </div>

                <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/80 border border-slate-800/50">
                  <div class="flex items-center gap-2 text-slate-300">
                    <span class="text-base">🔘</span>
                    <span class="font-medium">מתג אישור טלוויזיה</span>
                  </div>
                  <span id="preview-tv-toggle" class="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-800 text-slate-300">טוען...</span>
                </div>

                <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/80 border border-slate-800/50">
                  <div class="flex items-center gap-2 text-slate-300">
                    <span class="text-base">🔓</span>
                    <span class="font-medium">מעקף הורים (פתיחת טלוויזיה)</span>
                  </div>
                  <span id="preview-parent-bypass" class="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-800 text-slate-300">off</span>
                </div>

                <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/80 border border-slate-800/50">
                  <div class="flex items-center gap-2 text-slate-300">
                    <span class="text-base">✔️</span>
                    <span class="font-medium">כל המשימות הושלמו</span>
                  </div>
                  <span id="preview-all-done" class="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-800 text-slate-300">טוען...</span>
                </div>

                <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/80 border border-slate-800/50">
                  <div class="flex items-center gap-2 text-slate-300">
                    <span class="text-base">📝</span>
                    <span class="font-medium">משימות שנותרו לביצוע</span>
                  </div>
                  <span id="preview-remaining" class="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-800 text-slate-300">-</span>
                </div>

                <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/80 border border-slate-800/50">
                  <div class="flex items-center gap-2 text-slate-300">
                    <span class="text-base">📊</span>
                    <span class="font-medium">אחוז ביצוע כולל</span>
                  </div>
                  <span id="preview-percentage" class="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-800 text-slate-300">-</span>
                </div>

                <div class="pt-2 border-t border-slate-800 text-[11px] font-bold text-indigo-400">
                  👦 פירוט לפי ילדים
                </div>
                <div id="preview-children-entities" class="space-y-1.5">
                  <!-- Injected dynamically -->
                </div>
              </div>
            </div>
          </div>

          <!-- YAML Code Display -->
          <div class="space-y-2">
            <div class="text-xs font-bold text-slate-400 flex items-center justify-between">
              <span class="flex items-center gap-1.5">
                <span>📄</span>
                <span>קוד ה-YAML של הכרטיס:</span>
              </span>
              <span class="text-[10px] text-slate-500">מתעדכן דינמית</span>
            </div>
            <pre id="card-yaml-code" class="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-xs font-mono text-indigo-300 overflow-x-auto h-72 leading-relaxed dir-ltr text-left">טוען קוד YAML...</pre>
          </div>
        </div>
      </div>

      <!-- Ready-to-Use Home Assistant YAML Automations -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-black text-white flex items-center gap-2">
              <span>📋</span>
              <span>אוטומציית Home Assistant לחסימת טלוויזיה (YAML)</span>
            </h3>
            <p class="text-xs text-slate-400 mt-0.5">משתמש בישות שנוצרה אוטומטית <code class="text-emerald-400 font-mono">binary_sensor.kids_tasks_allow_tv</code></p>
          </div>
          <button onclick="copyHassYaml()" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 transition">
            העתק קוד YAML 📄
          </button>
        </div>

        <pre id="hass-yaml-code" class="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-xs font-mono text-indigo-300 overflow-x-auto leading-relaxed dir-ltr text-left">
# אוטומציה: כיבוי מיידי והודעה קולית כשהטלוויזיה נדלקת לפני סיום משימות
alias: "Kids Tasks - Block TV If Incomplete"
trigger:
  - platform: state
    entity_id: switch.tv_socket # החלף בשקע/טלוויזיה שלך ב-Hass
    to: "on"
condition:
  - condition: state
    entity_id: binary_sensor.kids_tasks_allow_tv # הישות שנוצרה אוטומטית מ-Kids Tasker
    state: "off"
action:
  - service: homeassistant.turn_off
    target:
      entity_id: switch.tv_socket
  - service: tts.speak
    target:
      entity_id: tts.google_en_com
    data:
      media_player_entity_id: media_player.living_room_speaker
      message: "הטלוויזיה כבויה עד שתסיימו את כל המשימות היומיות בלוח!"
mode: single
</pre>
      </div>
    </section>

  </main>

  <footer class="py-4 text-center text-xs text-slate-500 border-t border-slate-900">
    לוח ניהול הורים &bull; kids-tasker &bull; שינויים נשמרים ישירות לקובץ tasks.json
  </footer>

  <!-- Socket.io -->
  <script src="/socket.io/socket.io.js"></script>

  <script>
    let appData = null;
    let availableIcons = [];
    let activeTab = 'status';

    function showToast(message, type = 'success') {
      let toast = document.getElementById('toast-notification');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        document.body.appendChild(toast);
      }
      toast.innerText = message;
      toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-2 transition-all duration-300 opacity-100 pointer-events-auto transform translate-y-0 ' + 
        (type === 'success' ? 'bg-emerald-600 text-white shadow-emerald-950/50' : 'bg-rose-600 text-white');
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => {
        toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl font-bold text-sm flex items-center gap-2 transition-all duration-300 opacity-0 pointer-events-none transform translate-y-4';
      }, 2800);
    }

    function formatTime(isoString) {
      if (!isoString) return '-';
      try {
        const d = new Date(isoString);
        return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch (e) {
        return '-';
      }
    }

    function formatDateDisplay(dateStr) {
      if (!dateStr) return '';
      try {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
          const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
          return new Intl.DateTimeFormat('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(d);
        }
      } catch (e) {}
      return dateStr;
    }

    function switchTab(tab) {
      activeTab = tab;
      ['status', 'manage', 'history', 'hass'].forEach(t => {
        const section = document.getElementById('tab-' + t);
        const btn = document.getElementById('tab-btn-' + t);
        if (t === tab) {
          section.classList.remove('hidden');
          btn.className = 'px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-indigo-600 text-white shadow-md';
        } else {
          section.classList.add('hidden');
          btn.className = 'px-4 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 bg-slate-800/80 text-slate-300 hover:bg-slate-800';
        }
      });

      if (tab === 'history') {
        loadHistoryDates();
      } else if (tab === 'hass') {
        loadHassConfig();
        loadCardYamlAndPreview();
      }
    }

    const statusBadge = document.getElementById('status-badge');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    function updateConnectionStatus(isConnected) {
      if (isConnected) {
        statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50';
        statusText.innerText = 'מחובר';
        statusBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-950/60 border border-emerald-800/60 text-emerald-300';
      } else {
        statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse';
        statusText.innerText = 'מתחבר...';
        statusBadge.className = 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-950/60 border border-rose-800/60 text-rose-300';
      }
    }

    const socket = io();
    socket.on('connect', () => updateConnectionStatus(true));
    socket.on('disconnect', () => updateConnectionStatus(false));
    socket.on('task_updated', (updatedData) => {
      appData = updatedData;
      renderAll();
      if (activeTab === 'history') {
        const sel = document.getElementById('history-date-select');
        loadHistory(sel ? sel.value : null);
      } else if (activeTab === 'hass') {
        loadCardYamlAndPreview();
      }
    });

    function reconnectSocket() {
      loadData();
      if (!socket.connected) {
        socket.connect();
      }
    }

    // Pull-to-refresh: swipe down from top → hard reload
    (function initPullToRefresh() {
      let startY = 0;
      let pulling = false;
      const THRESHOLD = 120;

      document.addEventListener('touchstart', e => {
        if (window.scrollY === 0) {
          startY = e.touches[0].clientY;
          pulling = true;
        }
      }, { passive: true });

      document.addEventListener('touchmove', e => {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 10 && window.scrollY === 0) {
          document.body.style.transition = 'transform 0.1s';
          document.body.style.transform = \`translateY(\${Math.min(dy * 0.4, 60)}px)\`;
        }
      }, { passive: true });

      document.addEventListener('touchend', e => {
        if (!pulling) return;
        const dy = e.changedTouches[0].clientY - startY;
        document.body.style.transition = 'transform 0.2s';
        document.body.style.transform = '';
        if (dy >= THRESHOLD && window.scrollY === 0) {
          location.reload();
        }
        pulling = false;
      }, { passive: true });
    })();

    async function loadIcons() {
      try {
        const res = await fetch('/api/icons');
        availableIcons = await res.json();
      } catch (err) {
        console.error('Failed to load icons:', err);
      }
    }

    async function loadData() {
      try {
        await loadIcons();
        const res = await fetch('/api/tasks');
        appData = await res.json();
        renderAll();
      } catch (err) {
        console.error('Failed to load tasks data:', err);
      }
    }

    function updateBypassUI() {
      const isBypass = Boolean(appData?.homeAssistant?.parentBypass);
      const bypassBadge = document.getElementById('bypass-badge');
      const bypassBtn = document.getElementById('btn-toggle-bypass');
      const previewBypass = document.getElementById('preview-parent-bypass');

      if (bypassBadge) {
        bypassBadge.innerText = isBypass ? 'פעיל 🔓' : 'כבוי 🔒';
        bypassBadge.className = isBypass 
          ? 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-900 text-purple-200 border border-purple-700' 
          : 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400';
      }
      if (bypassBtn) {
        bypassBtn.innerHTML = isBypass ? '<span>🔒 בטל מעקף הורים</span>' : '<span>🔓 הפעל מעקף עכשיו</span>';
        bypassBtn.className = isBypass 
          ? 'px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition flex items-center gap-2 bg-rose-700 hover:bg-rose-600 text-white' 
          : 'px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white';
      }
      if (previewBypass) {
        previewBypass.innerText = isBypass ? 'on (פעיל)' : 'off (כבוי)';
        previewBypass.className = 'px-2 py-0.5 rounded font-mono font-bold text-[11px] ' + (isBypass ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-slate-800 text-slate-300');
      }
    }

    function renderAll() {
      if (!appData) return;
      renderStatusTab();
      renderManageTab();
      updateBypassUI();
    }

    // --- TAB 1: Status Render ---
    function renderStatusTab() {
      const container = document.getElementById('status-cards-container');
      const statsContainer = document.getElementById('overall-stats');
      const dateElem = document.getElementById('status-current-date');

      try {
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        dateElem.innerText = new Intl.DateTimeFormat('he-IL', options).format(new Date());
      } catch (e) {
        dateElem.innerText = new Date().toLocaleDateString('he-IL');
      }

      let totalTasks = 0;
      let completedTasks = 0;

      appData.children.forEach(c => {
        totalTasks += c.tasks.length;
        completedTasks += c.tasks.filter(t => t.completed).length;
      });

      const overallPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const allDone = totalTasks > 0 && completedTasks === totalTasks;
      const isBypass = Boolean(appData.homeAssistant && appData.homeAssistant.parentBypass);
      const isTvAllowed = allDone || isBypass;

      statsContainer.innerHTML = \`
        <div class="px-4 py-2 bg-slate-900 border border-slate-800 rounded-2xl text-center">
          <div class="text-xs text-slate-400 font-medium">סך הכל משימות</div>
          <div class="text-xl font-black text-white">\${completedTasks} / \${totalTasks}</div>
        </div>
        <div class="px-4 py-2 bg-slate-900 border border-slate-800 rounded-2xl text-center">
          <div class="text-xs text-slate-400 font-medium">אחוז ביצוע כולל</div>
          <div class="text-xl font-black text-indigo-400">\${overallPct}%</div>
        </div>
        \${appData.homeAssistant && appData.homeAssistant.enabled ? \`
          <div class="px-4 py-2 bg-slate-900 border border-slate-800 rounded-2xl text-center flex flex-col justify-center">
            <div class="text-xs text-slate-400 font-medium">סטטוס טלוויזיה</div>
            <div class="text-sm font-black \${allDone ? 'text-emerald-400' : (isBypass ? 'text-purple-400' : 'text-rose-400')}">
              \${allDone ? 'מותרת להדלקה ✔' : (isBypass ? 'מותרת (מעקף הורים) 🔓' : 'חסומה (מופעל כיבוי) 🔒')}
            </div>
          </div>
        \` : ''}
      \`;

      if (appData.children.length === 0) {
        container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-500 font-bold">אין ילדים מוגדרים. עבור ללשונית "ניהול ילדים ומשימות" להוספה.</div>';
        return;
      }

      container.innerHTML = appData.children.map(child => {
        const total = child.tasks.length;
        const done = child.tasks.filter(t => t.completed).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const isFinished = total > 0 && done === total;

        return \`
          <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col gap-4">
            <div class="flex items-center justify-between pb-3 border-b border-slate-800">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-xl font-bold text-indigo-200">
                  \${child.name.charAt(0)}
                </div>
                <div>
                  <h3 class="text-xl font-black text-white flex items-center gap-2">
                    \${child.name}
                    \${isFinished ? '<span>🎉</span>' : ''}
                  </h3>
                  <p class="text-xs text-slate-400 font-semibold">\${done} מתוך \${total} בוצעו (\${pct}%)</p>
                </div>
              </div>
              <span class="px-3 py-1 text-xs font-bold rounded-full \${isFinished ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-300 border border-slate-700'}">
                \${pct}%
              </span>
            </div>

            <!-- Tasks list in parent status -->
            <div class="space-y-2">
              \${child.tasks.length === 0 ? '<p class="text-xs text-slate-500 py-3 text-center">אין משימות</p>' : child.tasks.map(task => {
                const isDone = task.completed;
                const timeStr = isDone && task.completedAt ? formatTime(task.completedAt) : null;
                const icon = task.icon || 'star';

                return \`
                  <div class="flex items-center justify-between p-3 rounded-2xl \${isDone ? 'bg-emerald-950/40 border border-emerald-800/40 text-emerald-100' : 'bg-slate-950/60 border border-slate-800 text-slate-300'} transition">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="w-8 h-8 rounded-lg bg-black/20 p-1 flex items-center justify-center flex-shrink-0">
                        <img src="/icons/\${icon}.svg" alt="" class="w-full h-full object-contain" onerror="this.src='/icons/star.svg'">
                      </div>
                      <div class="flex flex-col min-w-0">
                        <span class="font-bold text-sm truncate \${isDone ? 'line-through text-emerald-300/80' : 'text-white'}">\${task.title}</span>
                        \${timeStr ? \`<span class="text-xs text-emerald-400 font-medium">הושלם בשעה \${timeStr}</span>\` : '<span class="text-xs text-slate-500">טרם בוצע</span>'}
                      </div>
                    </div>
                    <button 
                      onclick="toggleTaskFromParent('\${child.id}', '\${task.id}')"
                      class="px-3 py-1 rounded-xl text-xs font-bold transition \${isDone ? 'bg-emerald-600/50 hover:bg-emerald-600 text-white' : 'bg-rose-700/50 hover:bg-rose-700 text-white'}"
                    >
                      \${isDone ? 'בטל ביצוע' : 'סמן כבוצע'}
                    </button>
                  </div>
                \`;
              }).join('')}
            </div>
          </div>
        \`;
      }).join('');
    }

    // --- TAB 2: Manage Children & Tasks ---
    function renderManageTab() {
      const container = document.getElementById('children-manage-container');
      
      const activeEl = document.activeElement;
      if (activeEl && container.contains(activeEl) && activeEl.tagName === 'INPUT') {
        return;
      }

      if (appData.children.length === 0) {
        container.innerHTML = '<div class="text-center py-12 text-slate-500 font-bold">אין ילדים מוגדרים עדיין</div>';
        return;
      }

      const iconOptionsHtml = '<option value="none">⬜ ללא אייקון</option>' + availableIcons.map(ic => \`
        <option value="\${ic.id}">\${ic.emoji} \${ic.name}</option>
      \`).join('');

      container.innerHTML = appData.children.map(child => {
        return \`
          <div class="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div class="flex items-center gap-3 flex-1 min-w-[200px]">
                <div class="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-xl font-bold text-white shadow-md">
                  \${child.name.charAt(0)}
                </div>
                <div class="flex-1">
                  <form onsubmit="event.preventDefault(); handleUpdateChild('\${child.id}');" class="flex items-center gap-2">
                    <input 
                      type="text" 
                      id="child-name-\${child.id}" 
                      value="\${child.name}" 
                      onblur="handleUpdateChild('\${child.id}', true)"
                      onkeydown="if(event.key === 'Enter'){ event.preventDefault(); handleUpdateChild('\${child.id}'); }"
                      class="bg-slate-950 border border-slate-700 text-white font-extrabold text-xl px-3 py-1.5 rounded-xl focus:ring-2 focus:ring-indigo-500 max-w-xs transition"
                      title="לחץ Enter או לחץ מחוץ לתיבה לשמירה אוטומטית לקובץ"
                    >
                    <button type="submit" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-1">
                      <span>שמור</span>
                      <span>💾</span>
                    </button>
                    <span id="feedback-child-\${child.id}" class="text-xs font-bold text-emerald-400 hidden">✓ נשמר!</span>
                  </form>
                  <span class="text-xs text-slate-500 font-semibold">\${child.tasks.length} משימות מוגדרות</span>
                </div>
              </div>

              <div>
                <button onclick="handleDeleteChild('\${child.id}', '\${child.name}')" class="px-3.5 py-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-bold transition">
                  מחק ילד/ה 🗑️
                </button>
              </div>
            </div>

            <form onsubmit="handleAddTask(event, '\${child.id}')" class="flex flex-wrap gap-2.5">
              <input 
                type="text" 
                id="new-task-title-\${child.id}" 
                placeholder="הוסף משימה חדשה עבור \${child.name}..." 
                required
                class="flex-1 min-w-[200px] px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
              
              <select 
                id="new-task-icon-\${child.id}" 
                class="px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                \${iconOptionsHtml}
              </select>

              <button type="submit" class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-md transition whitespace-nowrap">
                + הוסף משימה
              </button>
            </form>

            <div class="space-y-2.5">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">רשימת משימות <span class="text-slate-600 font-normal normal-case">(גרור לשינוי סדר)</span></h4>
              <div
                class="task-sortable-list space-y-2"
                data-child-id="\${child.id}"
                ondragover="event.preventDefault()"
                ondrop="handleTaskDrop(event, '\${child.id}')"
              >
                \${child.tasks.length === 0 ? '<p class="text-sm text-slate-500 py-2">אין משימות עדיין</p>' : child.tasks.map(task => {
                  const currentIcon = task.icon || 'star';
                  const isNone = currentIcon === 'none';
                  const taskIconOptions = '<option value="none"' + (isNone ? ' selected' : '') + '>⬜ ללא אייקון</option>' +
                    availableIcons.map(ic => \`<option value="\${ic.id}" \${ic.id === currentIcon ? 'selected' : ''}>\${ic.emoji} \${ic.name}</option>\`).join('');
                  const iconPreviewHtml = isNone
                    ? \`<div id="task-preview-\${child.id}-\${task.id}" class="w-full h-full"></div>\`
                    : \`<img src="/icons/\${currentIcon}.svg" id="task-preview-\${child.id}-\${task.id}" alt="" class="w-full h-full object-contain" onerror="this.parentElement.innerHTML='';"></img>\`;

                  return \`
                    <div
                      class="task-drag-row flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-3 bg-slate-950/60 border border-slate-800/90 rounded-2xl cursor-grab active:cursor-grabbing transition-colors"
                      draggable="true"
                      data-task-id="\${task.id}"
                      data-child-id="\${child.id}"
                      ondragstart="handleTaskDragStart(event, '\${child.id}', '\${task.id}')"
                      ondragend="handleTaskDragEnd(event)"
                      ondragover="event.preventDefault(); handleTaskDragOver(event)"
                    >
                      <span class="text-slate-600 hover:text-slate-400 select-none flex-shrink-0 cursor-grab text-lg leading-none" title="גרור לשינוי סדר">⠿</span>

                      <div class="flex items-center gap-3 flex-1 min-w-[200px]">
                        <div class="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 p-1 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          \${iconPreviewHtml}
                        </div>

                        <select
                          id="task-icon-\${child.id}-\${task.id}"
                          onchange="handleUpdateTask('\${child.id}', '\${task.id}', true)"
                          class="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          title="שנה אייקון"
                        >
                          \${taskIconOptions}
                        </select>

                        <input
                          type="text"
                          id="task-title-\${child.id}-\${task.id}"
                          value="\${task.title}"
                          onblur="handleUpdateTask('\${child.id}', '\${task.id}', true)"
                          onkeydown="if(event.key === 'Enter'){ event.preventDefault(); handleUpdateTask('\${child.id}', '\${task.id}'); }"
                          class="bg-transparent border-b border-slate-700 focus:border-indigo-500 text-white font-bold text-sm px-2 py-1 flex-1 focus:bg-slate-900 rounded focus:outline-none transition"
                          title="לחץ Enter או לחץ מחוץ לתיבה לשמירה אוטומטית לקובץ"
                        >
                      </div>

                      <div class="flex items-center gap-2">
                        <button onclick="handleUpdateTask('\${child.id}', '\${task.id}')" class="px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1" title="שמור שינוי כותרת ואייקון לקובץ">
                          <span>שמור</span>
                          <span>💾</span>
                        </button>
                        <span id="feedback-task-\${child.id}-\${task.id}" class="text-xs font-bold text-emerald-400 hidden">✓ נשמר!</span>
                        <button onclick="handleDeleteTask('\${child.id}', '\${task.id}', '\${task.title}')" class="p-2 hover:bg-rose-950 text-rose-400 rounded-xl text-xs font-bold transition" title="מחק משימה">
                          🗑️
                        </button>
                      </div>
                    </div>
                  \`;
                }).join('')}
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    // --- TAB 3: History & Logs ---
    async function loadHistoryDates() {
      try {
        const res = await fetch('/api/history');
        const data = await res.json();
        const select = document.getElementById('history-date-select');
        
        const todayStr = new Date().toISOString().split('T')[0];
        const dates = data.availableDates || [];
        if (!dates.includes(todayStr)) {
          dates.unshift(todayStr);
        }

        const currentVal = select.value || todayStr;
        select.innerHTML = dates.map(d => \`
          <option value="\${d}" \${d === currentVal ? 'selected' : ''}>\${d} (\${formatDateDisplay(d)})</option>
        \`).join('');

        loadHistory(select.value);
      } catch (err) {
        console.error('Error loading history dates:', err);
      }
    }

    async function loadHistory(date) {
      if (!date) {
        date = new Date().toISOString().split('T')[0];
      }
      try {
        const res = await fetch(\`/api/history?date=\${date}\`);
        const data = await res.json();
        renderHistoryData(date, data.history);
      } catch (err) {
        console.error('Error loading history for date:', err);
      }
    }

    function renderHistoryData(date, historyEntries) {
      const summaryContainer = document.getElementById('history-summary-container');
      const tableBody = document.getElementById('history-table-body');

      const completedCount = (historyEntries || []).filter(h => h.completed).length;

      summaryContainer.innerHTML = \`
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div class="text-xs text-slate-400 font-medium">תאריך נבחר</div>
          <div class="text-lg font-black text-white">\${date}</div>
          <div class="text-xs text-indigo-400 font-semibold mt-0.5">\${formatDateDisplay(date)}</div>
        </div>
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div class="text-xs text-slate-400 font-medium">משימות שהושלמו ביום זה</div>
          <div class="text-2xl font-black text-emerald-400">\${completedCount}</div>
        </div>
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
          <div class="text-xs text-slate-400 font-medium">פעולות שנרשמו ביומן</div>
          <div class="text-2xl font-black text-white">\${(historyEntries || []).length}</div>
        </div>
      \`;

      if (!historyEntries || historyEntries.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-slate-500 font-bold">לא נמצאו רישומי פעילות לתאריך זה</td></tr>';
        return;
      }

      tableBody.innerHTML = historyEntries.map(entry => {
        const isDone = entry.completed;
        const timeFormatted = formatTime(entry.timestamp);
        const icon = entry.icon || 'star';

        return \`
          <tr class="hover:bg-slate-800/40 transition">
            <td class="py-3 px-4 font-mono text-slate-300">\${timeFormatted}</td>
            <td class="py-3 px-4 font-bold text-white">\${entry.childName}</td>
            <td class="py-3 px-4 text-slate-200">
              <div class="flex items-center gap-2">
                <img src="/icons/\${icon}.svg" class="w-5 h-5 object-contain" alt="" onerror="this.src='/icons/star.svg'">
                <span>\${entry.taskTitle}</span>
              </div>
            </td>
            <td class="py-3 px-4">
              \${isDone ? 
                '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">הושלם ✔</span>' : 
                '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-950/80 border border-rose-700/60 text-rose-300">בוטל ❌</span>'}
            </td>
          </tr>
        \`;
      }).join('');
    }

    // --- TAB 4: Home Assistant Config & Testing & Entity Creation ---
    async function loadHassConfig() {
      try {
        const res = await fetch('/api/hass/config');
        const config = await res.json();
        
        document.getElementById('hass-enabled').checked = Boolean(config.enabled);
        document.getElementById('hass-url').value = config.url || '';
        document.getElementById('hass-token').value = config.hasToken ? config.tokenMasked : '';
        document.getElementById('hass-tv-entity').value = config.tvEntityId || '';
        document.getElementById('hass-auto-block').checked = Boolean(config.autoBlockTv);
      } catch (err) {
        console.error('Failed to load Home Assistant config:', err);
      }
    }

    async function handleCreateHassEntities() {
      const btn = document.getElementById('btn-create-entities');
      const feedback = document.getElementById('hass-entities-feedback');
      const listContainer = document.getElementById('hass-entities-list');
      btn.disabled = true;
      btn.innerText = 'מייצר ישויות... ⏳';

      try {
        const res = await fetch('/api/hass/create-entities', { method: 'POST' });
        const data = await res.json();

        feedback.classList.remove('hidden');
        if (data.success && data.entities && data.entities.length > 0) {
          feedback.className = 'p-3 rounded-xl text-xs font-bold bg-emerald-950 border border-emerald-700 text-emerald-300';
          feedback.innerText = \`✓ נוצרו וסונכרנו בהצלחה \${data.entities.length} ישויות ב-Home Assistant!\`;

          listContainer.innerHTML = data.entities.map(ent => \`
            <div class="p-3 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="font-bold text-xs sm:text-sm text-indigo-300 font-mono truncate">\${ent.entity_id}</div>
                <div class="text-xs text-slate-400 mt-0.5 truncate">\${ent.friendly_name}</div>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="px-2.5 py-1 text-xs font-bold rounded-lg \${ent.state === 'on' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-900 text-slate-300 border border-slate-800'}">
                  מצב: \${ent.state}
                </span>
                <button onclick="navigator.clipboard.writeText('\${ent.entity_id}'); showToast('מזהה הישות הועתק! 📋');" class="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition" title="העתק מזהה">
                  📋
                </button>
              </div>
            </div>
          \`).join('');

          showToast(\`\${data.entities.length} ישויות נוצרו ב-Home Assistant! ✓\`);
        } else {
          feedback.className = 'p-3 rounded-xl text-xs font-bold bg-rose-950 border border-rose-700 text-rose-300';
          feedback.innerText = 'שגיאה: ' + (data.error || 'נכשל ביצירת ישויות. ודא שהאינטגרציה מופעלת והחיבור תקין.');
        }
      } catch (err) {
        feedback.classList.remove('hidden');
        feedback.className = 'p-3 rounded-xl text-xs font-bold bg-rose-950 border border-rose-700 text-rose-300';
        feedback.innerText = 'שגיאת רשת ביצירת ישויות: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.innerText = '⚡ צור / רענן ישויות עכשיו';
      }
    }

    async function handleSaveHassConfig(e) {
      e.preventDefault();
      const enabled = document.getElementById('hass-enabled').checked;
      const url = document.getElementById('hass-url').value.trim();
      const token = document.getElementById('hass-token').value.trim();
      const tvEntityId = document.getElementById('hass-tv-entity').value.trim();
      const autoBlockTv = document.getElementById('hass-auto-block').checked;

      try {
        const res = await fetch('/api/hass/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, url, token, tvEntityId, autoBlockTv })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save');

        const feedback = document.getElementById('hass-save-feedback');
        feedback.classList.remove('hidden');
        setTimeout(() => feedback.classList.add('hidden'), 3000);
        showToast('הגדרות Home Assistant נשמרו וישויות סונכרנו! ✓');
        
        if (enabled) {
          handleCreateHassEntities();
        }
      } catch (err) {
        showToast('שגיאה בשמירת הגדרות: ' + err.message, 'error');
      }
    }

    async function handleTestHass() {
      const btn = document.getElementById('btn-test-hass');
      const resultBox = document.getElementById('hass-test-result');
      btn.disabled = true;
      btn.innerText = 'בודק חיבור... ⏳';

      const url = document.getElementById('hass-url').value.trim();
      const token = document.getElementById('hass-token').value.trim();
      const tvEntityId = document.getElementById('hass-tv-entity').value.trim();

      try {
        const res = await fetch('/api/hass/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, token, tvEntityId })
        });
        const data = await res.json();
        resultBox.classList.remove('hidden');

        if (data.ok) {
          let entityDetails = '';
          if (data.entityState) {
            const state = data.entityState.state;
            const name = data.entityState.attributes?.friendly_name || tvEntityId;
            entityDetails = \`
              <div class="mt-2 pt-2 border-t border-emerald-700/50 flex items-center justify-between text-xs">
                <span>ישות: <strong>\${name} (\${tvEntityId})</strong></span>
                <span class="px-2 py-0.5 rounded font-bold \${state === 'on' ? 'bg-amber-500/30 text-amber-300' : 'bg-slate-800 text-slate-300'}">מצב נוכחי: \${state}</span>
              </div>
            \`;
          }

          resultBox.className = 'p-4 rounded-2xl border text-sm font-medium bg-emerald-950/60 border-emerald-700/60 text-emerald-200';
          resultBox.innerHTML = \`
            <div class="flex items-center gap-2 font-bold text-emerald-300">
              <span>✔</span>
              <span>\${data.message}</span>
            </div>
            \${data.warning ? \`<p class="text-xs text-amber-300 mt-1">\${data.warning}</p>\` : ''}
            \${entityDetails}
          \`;
          showToast('בדיקת החיבור ל-Home Assistant עברה בהצלחה! ✓');
        } else {
          resultBox.className = 'p-4 rounded-2xl border text-sm font-medium bg-rose-950/60 border-rose-700/60 text-rose-200';
          resultBox.innerHTML = \`
            <div class="flex items-center gap-2 font-bold text-rose-300">
              <span>❌</span>
              <span>\${data.message}</span>
            </div>
          \`;
          showToast('בדיקת החיבור נכשלה', 'error');
        }
      } catch (err) {
        resultBox.classList.remove('hidden');
        resultBox.className = 'p-4 rounded-2xl border text-sm font-medium bg-rose-950/60 border-rose-700/60 text-rose-200';
        resultBox.innerHTML = 'שגיאת רשת בבדיקת חיבור: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.innerText = 'בדוק חיבור 📡';
      }
    }

    function copyHassYaml() {
      const code = document.getElementById('hass-yaml-code').innerText;
      navigator.clipboard.writeText(code).then(() => {
        showToast('קוד ה-YAML הועתק ללוח! 📋');
      }).catch(() => {
        alert('לא ניתן להעתיק אוטומטית. נא לסמן ולהעתיק ידנית.');
      });
    }

    async function loadCardYamlAndPreview() {
      try {
        const res = await fetch('/api/hass/card-yaml');
        const data = await res.json();
        if (data.success && data.yaml) {
          const yamlEl = document.getElementById('card-yaml-code');
          if (yamlEl) yamlEl.innerText = data.yaml;
        }
      } catch (e) {}

      // Update preview stats
      try {
        const res = await fetch('/api/hass/status');
        const st = await res.json();
        const tvAllow = document.getElementById('preview-tv-allow');
        const tvToggle = document.getElementById('preview-tv-toggle');
        const allDone = document.getElementById('preview-all-done');
        const remaining = document.getElementById('preview-remaining');
        const pct = document.getElementById('preview-percentage');
        const childContainer = document.getElementById('preview-children-entities');

        if (tvAllow) {
          tvAllow.innerText = st.all_completed ? 'on (מותר)' : 'off (חסום)';
          tvAllow.className = 'px-2 py-0.5 rounded font-mono font-bold text-[11px] ' + 
            (st.all_completed ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800');
        }
        if (tvToggle) {
          tvToggle.innerText = st.all_completed ? 'on' : 'off';
          tvToggle.className = tvAllow ? tvAllow.className : '';
        }
        if (allDone) {
          allDone.innerText = st.all_completed ? 'on (הושלם)' : 'off (טרם הושלם)';
          allDone.className = tvAllow ? tvAllow.className : '';
        }
        if (remaining) remaining.innerText = (st.remaining_tasks || 0) + ' משימות';
        if (pct) pct.innerText = (st.percentage || 0) + '%';

        const bypassBadge = document.getElementById('bypass-badge');
        const bypassBtn = document.getElementById('btn-toggle-bypass');
        const previewBypass = document.getElementById('preview-parent-bypass');

        const isBypass = Boolean(st.parent_bypass);
        if (bypassBadge) {
          bypassBadge.innerText = isBypass ? 'פעיל 🔓' : 'כבוי 🔒';
          bypassBadge.className = isBypass ? 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-900 text-purple-200 border border-purple-700' : 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400';
        }
        if (bypassBtn) {
          bypassBtn.innerHTML = isBypass ? '<span>🔒 בטל מעקף הורים</span>' : '<span>🔓 הפעל מעקף עכשיו</span>';
          bypassBtn.className = isBypass ? 'px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition flex items-center gap-2 bg-rose-700 hover:bg-rose-600 text-white' : 'px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white';
        }
        if (previewBypass) {
          previewBypass.innerText = isBypass ? 'on (פעיל)' : 'off (כבוי)';
          previewBypass.className = 'px-2 py-0.5 rounded font-mono font-bold text-[11px] ' + (isBypass ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-slate-800 text-slate-300');
        }

        if (childContainer && st.children) {
          childContainer.innerHTML = st.children.map(c => \`
            <div class="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800/40 text-xs">
              <span class="text-slate-300 font-medium">משימות \${c.name}</span>
              <span class="px-2 py-0.5 rounded font-mono font-bold text-[11px] \${c.all_completed ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-300'}">
                \${c.all_completed ? 'הושלמו ✔' : \`\${c.remaining} נותרו\`}
              </span>
            </div>
          \`).join('');
        }
      } catch (e) {}
    }

    async function handleToggleBypass() {
      const btn = document.getElementById('btn-toggle-bypass');
      btn.disabled = true;
      try {
        const stRes = await fetch('/api/hass/status');
        const st = await stRes.json();
        const nextState = !st.parent_bypass;

        const res = await fetch('/api/hass/bypass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextState })
        });
        const data = await res.json();
        if (data.success) {
          showToast(nextState ? 'מעקף הורים הופעל! הטלוויזיה מותרת 🔓' : 'מעקף הורים בוטל! 🔒');
          loadCardYamlAndPreview();
        } else {
          showToast('שגיאה בעדכון מעקף: ' + data.error, 'error');
        }
      } catch (err) {
        showToast('שגיאת רשת: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function handleAddLovelaceCard() {
      const btn = document.getElementById('btn-add-lovelace-card');
      const feedback = document.getElementById('hass-card-feedback');
      btn.disabled = true;
      btn.innerText = 'מוסיף כרטיס ל-Home Assistant... ⏳';

      try {
        const res = await fetch('/api/hass/add-card', { method: 'POST' });
        const data = await res.json();
        feedback.classList.remove('hidden');

        if (data.success) {
          feedback.className = 'p-4 rounded-2xl border text-sm font-medium bg-emerald-950/70 border-emerald-700 text-emerald-200';
          const hassUrl = document.getElementById('hass-url').value.trim() || 'http://homeassistant.local:8123';
          const targetUrl = hassUrl.replace(/\\/+$/, '') + (data.path || '/lovelace');
          feedback.innerHTML = \`
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2 font-bold text-emerald-300">
                <span>🎉</span>
                <span>\${data.message || 'הכרטיס נוסף בהצלחה ל-Home Assistant!'}</span>
              </div>
              <a href="\${targetUrl}" target="_blank" rel="noopener noreferrer" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow transition flex items-center gap-1.5">
                <span>פתח דשבורד ב-Home Assistant ↗️</span>
              </a>
            </div>
          \`;
          showToast('הכרטיס נוסף בהצלחה ל-Home Assistant! 🎉');
        } else {
          feedback.className = 'p-4 rounded-2xl border text-sm font-medium bg-rose-950/70 border-rose-700 text-rose-200';
          feedback.innerHTML = \`
            <div class="flex items-center gap-2 font-bold text-rose-300">
              <span>❌</span>
              <span>שגיאה בהוספת הכרטיס: \${data.error || 'נא לוודא ש-Home Assistant מופעל והטוקן תקין.'}</span>
            </div>
          \`;
          showToast('נכשל בהוספת הכרטיס ל-Home Assistant', 'error');
        }
      } catch (err) {
        feedback.classList.remove('hidden');
        feedback.className = 'p-4 rounded-2xl border text-sm font-medium bg-rose-950/70 border-rose-700 text-rose-200';
        feedback.innerText = 'שגיאת רשת: ' + err.message;
      } finally {
        btn.disabled = false;
        btn.innerText = '➕ הוסף כרטיס ל-Home Assistant בלחיצה אחת';
      }
    }

    function handleCopyCardYaml() {
      const code = document.getElementById('card-yaml-code').innerText;
      navigator.clipboard.writeText(code).then(() => {
        showToast('קוד ה-YAML של הכרטיס הועתק ללוח! 📋');
      }).catch(() => {
        alert('לא ניתן להעתיק אוטומטית. נא לסמן ולהעתיק ידנית.');
      });
    }

    // --- Actions Handlers with Instant Auto-Persistence & Confirmation Feedback ---
    async function toggleTaskFromParent(childId, taskId) {
      try {
        await fetch('/api/tasks/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ childId, taskId, isParent: true })
        });
      } catch (err) {
        showToast('שגיאה בעדכון משימה: ' + err.message, 'error');
      }
    }

    async function handleCreateChild(e) {
      e.preventDefault();
      const input = document.getElementById('new-child-name');
      const name = input.value.trim();
      if (!name) return;

      try {
        const res = await fetch('/api/children', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error('Failed to create child');
        input.value = '';
        showToast(\`הילד/ה "\${name}" נוסף/ה ונשמר/ה בקובץ! ✓\`);
      } catch (err) {
        showToast('שגיאה בהוספת ילד: ' + err.message, 'error');
      }
    }

    async function handleUpdateChild(childId, silent = false) {
      const input = document.getElementById(\`child-name-\${childId}\`);
      if (!input) return;
      const name = input.value.trim();
      if (!name) return;

      const currentChild = appData && appData.children ? appData.children.find(c => c.id === childId) : null;
      if (currentChild && currentChild.name === name) return;

      try {
        const res = await fetch(\`/api/children/\${childId}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error('Failed to update child');
        
        if (currentChild) currentChild.name = name;

        const feedback = document.getElementById(\`feedback-child-\${childId}\`);
        if (feedback) {
          feedback.classList.remove('hidden');
          setTimeout(() => feedback.classList.add('hidden'), 2500);
        }
        input.classList.add('border-emerald-500');
        setTimeout(() => input.classList.remove('border-emerald-500'), 2000);
        showToast(\`השם עודכן ל-"\${name}" ונשמר בהצלחה לקובץ! ✓\`);
      } catch (err) {
        if (!silent) showToast('שגיאה בעדכון שם הילד: ' + err.message, 'error');
      }
    }

    async function handleDeleteChild(childId, childName) {
      if (!confirm(\`האם למחוק את \${childName} ואת כל המשימות המשויכות?\\nהפעולה תישמר ישירות לקובץ tasks.json.\`)) return;

      try {
        const res = await fetch(\`/api/children/\${childId}\`, {
          method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete child');
        showToast(\`\${childName} נמחק/ה בהצלחה מהקובץ! ✓\`);
      } catch (err) {
        showToast('שגיאה במחיקת הילד: ' + err.message, 'error');
      }
    }

    async function handleAddTask(e, childId) {
      e.preventDefault();
      const titleInput = document.getElementById(\`new-task-title-\${childId}\`);
      const iconInput = document.getElementById(\`new-task-icon-\${childId}\`);
      const title = titleInput.value.trim();
      const icon = iconInput ? iconInput.value : 'star';
      if (!title) return;

      try {
        const res = await fetch(\`/api/children/\${childId}/tasks\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, icon })
        });
        if (!res.ok) throw new Error('Failed to add task');
        titleInput.value = '';
        showToast(\`המשימה "\${title}" נוספה ונשמרה בקובץ! ✓\`);
      } catch (err) {
        showToast('שגיאה בהוספת משימה: ' + err.message, 'error');
      }
    }

    async function handleUpdateTask(childId, taskId, silent = false) {
      const titleInput = document.getElementById(\`task-title-\${childId}-\${taskId}\`);
      const iconSelect = document.getElementById(\`task-icon-\${childId}-\${taskId}\`);
      const previewEl = document.getElementById(\`task-preview-\${childId}-\${taskId}\`);
      if (!titleInput) return;
      const title = titleInput.value.trim();
      const icon = iconSelect ? iconSelect.value : undefined;
      if (!title) return;

      // Update icon preview live
      if (previewEl) {
        if (!icon || icon === 'none') {
          if (previewEl.tagName === 'IMG') {
            const div = document.createElement('div');
            div.id = previewEl.id;
            div.className = 'w-full h-full';
            previewEl.replaceWith(div);
          } else {
            previewEl.innerHTML = '';
          }
        } else {
          if (previewEl.tagName === 'IMG') {
            previewEl.src = \`/icons/\${icon}.svg\`;
          } else {
            const img = document.createElement('img');
            img.id = previewEl.id;
            img.src = \`/icons/\${icon}.svg\`;
            img.alt = '';
            img.className = 'w-full h-full object-contain';
            img.onerror = function() { this.parentElement.innerHTML = ''; };
            previewEl.replaceWith(img);
          }
        }
      }

      const child = appData && appData.children ? appData.children.find(c => c.id === childId) : null;
      const task = child && child.tasks ? child.tasks.find(t => t.id === taskId) : null;
      if (task && task.title === title && task.icon === icon) return;

      try {
        const res = await fetch(\`/api/children/\${childId}/tasks/\${taskId}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, icon })
        });
        if (!res.ok) throw new Error('Failed to update task');

        if (task) {
          task.title = title;
          if (icon !== undefined) task.icon = icon;
        }

        const feedback = document.getElementById(\`feedback-task-\${childId}-\${taskId}\`);
        if (feedback) {
          feedback.classList.remove('hidden');
          setTimeout(() => feedback.classList.add('hidden'), 2500);
        }
        titleInput.classList.add('border-emerald-500');
        setTimeout(() => titleInput.classList.remove('border-emerald-500'), 2000);
        showToast(\`המשימה "\${title}" עודכנה ונשמרה בקובץ! ✓\`);
      } catch (err) {
        if (!silent) showToast('שגיאה בעדכון משימה: ' + err.message, 'error');
      }
    }

    async function handleDeleteTask(childId, taskId, taskTitle) {
      if (!confirm(\`האם למחוק את המשימה "\${taskTitle}"?\\nהפעולה תישמר לקובץ.\`)) return;

      try {
        const res = await fetch(\`/api/children/\${childId}/tasks/\${taskId}\`, {
          method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete task');
        showToast(\`המשימה "\${taskTitle}" נמחקה מהקובץ! ✓\`);
      } catch (err) {
        showToast('שגיאה במחיקת משימה: ' + err.message, 'error');
      }
    }

    // ---- Drag-to-reorder tasks ----
    let dragState = null; // { childId, taskId, sourceEl, overEl }

    function handleTaskDragStart(event, childId, taskId) {
      dragState = { childId, taskId, sourceEl: event.currentTarget, overEl: null };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskId);
      setTimeout(() => event.currentTarget.classList.add('opacity-40', 'scale-95'), 0);
    }

    function handleTaskDragEnd(event) {
      event.currentTarget.classList.remove('opacity-40', 'scale-95');
      document.querySelectorAll('.task-drag-row').forEach(el => {
        el.classList.remove('border-indigo-400');
      });
      dragState = null;
    }

    function handleTaskDragOver(event) {
      if (!dragState) return;
      const target = event.currentTarget.closest('.task-drag-row');
      if (!target || target === dragState.sourceEl) return;
      document.querySelectorAll('.task-drag-row').forEach(el => el.classList.remove('border-indigo-400'));
      target.classList.add('border-indigo-400');
      dragState.overEl = target;
    }

    async function handleTaskDrop(event, childId) {
      event.preventDefault();
      if (!dragState || dragState.childId !== childId || !dragState.overEl) return;

      const list = event.currentTarget;
      const rows = Array.from(list.querySelectorAll('.task-drag-row'));
      const sourceIdx = rows.indexOf(dragState.sourceEl);
      const targetIdx = rows.indexOf(dragState.overEl);
      if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return;

      if (sourceIdx < targetIdx) {
        dragState.overEl.after(dragState.sourceEl);
      } else {
        dragState.overEl.before(dragState.sourceEl);
      }

      const newOrder = Array.from(list.querySelectorAll('.task-drag-row')).map(el => el.dataset.taskId);

      try {
        const res = await fetch(\`/api/children/\${childId}/tasks/reorder\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskIds: newOrder })
        });
        if (!res.ok) throw new Error('Reorder failed');
        showToast('סדר המשימות עודכן ✓');
      } catch (err) {
        showToast('שגיאה בשמירת הסדר: ' + err.message, 'error');
        renderManageTab();
      }
    }

    async function confirmResetDay() {
      if (!confirm('האם לאפס את סימוני כל המשימות ליום חדש?\\n(שימו לב: שמות הילדים, המשימות וההיסטוריה נשמרים כרגיל!)')) return;

      try {
        const res = await fetch('/api/tasks/reset-day', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to reset daily tasks');
        showToast('משימות היום אופסו ליום חדש! כל השמות וההיסטוריה נשמרו ✓');
      } catch (err) {
        showToast('שגיאה באיפוס משימות: ' + err.message, 'error');
      }
    }

    // Initial Load
    loadData();

    // ==========================================
    // Parent Dashboard PIN Protection
    // ==========================================
    (function initParentPinLock() {
      const overlay = document.getElementById('parent-pin-overlay');
      const pinBox = document.getElementById('parent-pin-box');
      const pinDots = document.getElementById('pparent-pin-dots');
      const pinError = document.getElementById('pparent-pin-error');
      const delBtn = document.getElementById('pparent-pin-del');
      const MAX_PIN = 6;
      let currentPin = '';

      function renderDots(len) {
        pinDots.innerHTML = Array.from({ length: MAX_PIN }, (_, i) =>
          \`<div class="w-4 h-4 rounded-full border-2 transition-all duration-150 \${i < len ? 'bg-indigo-400 border-indigo-400 scale-110' : 'bg-transparent border-slate-600'}"></div>\`
        ).join('');
      }

      function showErr(msg) {
        pinError.textContent = msg;
        pinError.classList.remove('hidden');
        pinBox.classList.add('pparent-shake');
        setTimeout(() => pinBox.classList.remove('pparent-shake'), 400);
      }

      function clearErr() {
        pinError.classList.add('hidden');
        pinError.textContent = '';
      }

      async function submitParentPin() {
        if (currentPin.length < 4) { showErr('יש להזין לפחות 4 ספרות'); return; }
        try {
          const res = await fetch('/api/parent/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: currentPin })
          });
          const data = await res.json();
          if (data.success) {
            sessionStorage.setItem('kids_tasker_parent_unlocked', '1');
            overlay.classList.add('hidden');
          } else {
            showErr(data.error || 'קוד שגוי, נסה שוב');
            currentPin = '';
            renderDots(0);
          }
        } catch (e) {
          showErr('שגיאת תקשורת, נסה שוב');
        }
      }

      let pinAutoSubmitTimer = null;
      function onDigit(d) {
        if (currentPin.length >= MAX_PIN) return;
        currentPin += d;
        clearErr();
        renderDots(currentPin.length);
        // Clear any pending timer
        if (pinAutoSubmitTimer) clearTimeout(pinAutoSubmitTimer);
        // At MAX_PIN: immediate submit. At 4-5 digits: submit after 600ms if user stops typing
        if (currentPin.length === MAX_PIN) {
          pinAutoSubmitTimer = setTimeout(submitParentPin, 120);
        } else if (currentPin.length >= 4) {
          pinAutoSubmitTimer = setTimeout(submitParentPin, 600);
        }
      }

      function onDelete() {
        if (pinAutoSubmitTimer) { clearTimeout(pinAutoSubmitTimer); pinAutoSubmitTimer = null; }
        currentPin = currentPin.slice(0, -1);
        clearErr();
        renderDots(currentPin.length);
      }

      document.querySelectorAll('.pparent-pin-key[data-digit]').forEach(btn => {
        btn.addEventListener('pointerdown', e => { e.preventDefault(); onDigit(btn.dataset.digit); });
      });
      if (delBtn) delBtn.addEventListener('pointerdown', e => { e.preventDefault(); onDelete(); });

      document.addEventListener('keydown', e => {
        if (overlay.classList.contains('hidden')) return;
        if (e.key >= '0' && e.key <= '9') { e.preventDefault(); onDigit(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); onDelete(); }
        else if (e.key === 'Enter') { e.preventDefault(); submitParentPin(); }
      });

      async function checkPinRequired() {
        if (sessionStorage.getItem('kids_tasker_parent_unlocked') === '1') return;
        try {
          const res = await fetch('/api/parent/pin-status');
          const data = await res.json();
          if (data.hasPin) {
            overlay.classList.remove('hidden');
            renderDots(0);
          }
        } catch (e) { /* fail open */ }
      }

      checkPinRequired();
    })();

    function lockParentDashboard() {
      sessionStorage.removeItem('kids_tasker_parent_unlocked');
      window.location.href = '/';
    }
  </script>
</body>
</html>`);
});

// Socket.io connection logging
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start Server after initializing storage
function start() {
  initTasksStorage();
  startHassPolling();
  startHassEventListener();
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` kids-tasker server is running!`);
    console.log(` Kids Board URL:    http://localhost:${PORT}`);
    console.log(` Parents Dash URL:  http://localhost:${PORT}/parent`);
    console.log(` HASS Status API:   http://localhost:${PORT}/api/hass/status`);
    console.log(` Tasks file:        ${TASKS_FILE}`);
    console.log(`====================================================`);
  });
}

start();
