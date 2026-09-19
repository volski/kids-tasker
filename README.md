# Kids Task Board (לוח משימות לילדים)

An all-in-one, self-contained Node.js application (`server.js`) serving a real-time Single Page Application (SPA) for kids' daily routines and chore tracking, complete with a **Parent Management Dashboard** (`/parent`), full CRUD for children and tasks, live status tracking with completion timestamps, persistent daily historical logs, visual task icons, and **Home Assistant (Hass.io) TV Blocking Integration**.

> 🏠 **Looking to host on Proxmox VE?** Check out the **[Proxmox VE Hosting Guide (LXC & Docker)](PROXMOX.md)** for a 1-click Proxmox LXC container installer and Docker setup!

---

## Features

### 1. Tablet Task Board (`/`)
- **Real-Time Synchronization:** Any task toggled updates across all connected tablets/screens instantaneously via Socket.io.
- **Modern Hebrew RTL Interface:** Built with Tailwind CSS in dark theme (Slate-950, Emerald, Rose).
- **Rich Vector Icons:** Every chore displays a dedicated SVG icon (toothbrush, clothes, school backpack, books, bed, bath, food, etc.).
- **One-Way Kid Completion (To Do &rarr; Done 🔒):** Children can only mark tasks as completed (`טרם בוצע` &rarr; `בוצע ✔`). Once a task is completed, it is locked on the kids' tablet with a lock badge (`בוצע ✔ 🔒`) and cannot be unchecked by children. Only parents can uncheck or revert completed tasks via the Parent Dashboard (`/parent`).
- **Live TV Status Indicator:** When Home Assistant integration is active, displays whether TV is locked (`🔒 טלוויזיה חסומה`), unlocked (`📺 טלוויזיה מותרת! 🎉`), or unlocked via parent bypass (`📺 טלוויזיה מותרת (מעקף הורים) 🔓`).
- **Clear Touch Feedback:**
  - **Completed (בוצע ✔):** `bg-emerald-600` with checkmark, strikethrough, and completion time (`הושלם בשעה 08:30`).
  - **Pending (טרם בוצע ❌):** `bg-rose-700` with text "טרם בוצע ❌".
  - Active touch state (`active:scale-[0.98]`), anti-zoom handling (`touch-action: manipulation`).
  - Child progress bar and celebration badge (`🎉`) upon full completion.
  - Direct quick link to Parent Dashboard (`⚙️ ניהול הורים`).

### 2. Parent Management Dashboard (`/parent`)
- **Tab 1 - Today's Live Status (סטטוס משימות היום):**
  - Live overview of all children, total chore completion rate, task icons, TV status, and completion timestamps.
  - Parents can toggle tasks directly from the dashboard.
- **Tab 2 - Manage Children & Tasks (ניהול ילדים ומשימות):**
  - **Add Child / Edit Child / Delete Child:** Auto-saves directly to `tasks.json` on `Enter` or `blur`.
  - **Add Task with Icon:** Choose an icon from the dropdown when adding a chore.
  - **Edit Task & Change Icon:** Preview and select a new icon for any existing chore anytime.
  - **Delete Task.**
- **Tab 3 - Daily History & Logs (היסטוריית משימות לפי תאריכים):**
  - Date dropdown selector to review performance on past dates.
  - Chronological activity log showing exact completion times (`HH:MM:SS`), child name, chore icon, title, and status.
- **Tab 4 - Home Assistant (Hass.io) & TV Blocking (בית חכם 🏠):**
  - **Integration Toggle:** Enable or disable connection to Home Assistant.
  - **Server URL & Access Token:** Connect to Hass.io with a Long-Lived Access Token.
  - **TV Entity ID:** Supports smart plugs (`switch.tv_socket`), smart TVs (`media_player.living_room_tv`), or virtual booleans (`input_boolean.allow_tv`).
  - **Active TV Block:** Automatically forces the TV off if turned on while daily chores remain incomplete.
  - **Live Diagnostics & Test Button:** Tests the connection and fetches the current TV state (`on`/`off`) in real-time.
  - **Virtual Binary Sensor:** Continuously updates `binary_sensor.kids_tasks_completed` in Home Assistant.
  - **Copy-Paste YAML Code:** Ready-to-use Home Assistant automation code with voice notifications.
- **Daily Reset ("איפוס ליום חדש"):**
  - Resets today's tasks to pending for a fresh morning routine without losing any child names, tasks, or history.

---

## Home Assistant (Hass.io) Integration & Automatic Entity Creation

### Automatic Entity Creation (No YAML Needed! 🚀)
Kids Tasker can automatically create and synchronize virtual entities in Home Assistant via the Home Assistant REST API. No manual `configuration.yaml` editing is required!

1. Open Home Assistant and go to your **User Profile** (bottom left) &rarr; **Security** &rarr; **Long-Lived Access Tokens** &rarr; **Create Token**.
2. Open the Kids Task Board Parent Dashboard at [http://localhost:3000/parent](http://localhost:3000/parent) and navigate to the **בית חכם (Home Assistant) 🏠** tab.
3. Check **הפעל אינטגרציה עם Home Assistant**.
4. Fill in your Home Assistant URL (e.g. `http://homeassistant.local:8123` or `http://192.168.1.100:8123`) and paste your Access Token.
5. *(Optional)* Enter your TV entity ID (e.g. `switch.tv_socket` or `media_player.living_room_tv`) and check **חסימת טלוויזיה אוטומטית**.
6. Click **שמור הגדרות**, then click **⚡ צור / רענן ישויות עכשיו**.

### Automatically Created Entities in Home Assistant:
| Entity ID | Type | Description | State Values |
| :--- | :--- | :--- | :--- |
| `binary_sensor.kids_tasks_allow_tv` | Binary Sensor | TV viewing permission indicator (combines chore status + parent bypass) | `on` (Allowed) / `off` (Locked) |
| `input_boolean.kids_tasks_allow_tv` | Input Boolean | Helper switch for automations & dashboards | `on` / `off` |
| `input_boolean.kids_tasks_parent_bypass` | Input Boolean | **Parent TV Bypass switch** — allows parents to authorize TV even when chores are pending | `on` (Bypass Active) / `off` (Standard rules) |
| `binary_sensor.kids_tasks_completed` | Binary Sensor | Indicates if all daily chores are completed | `on` (All done) / `off` (Pending) |
| `sensor.kids_tasks_remaining` | Sensor | Count of remaining uncompleted chores | Number (`0`, `1`, `2`, ...) |
| `sensor.kids_tasks_percentage` | Sensor | Overall completion percentage | Percentage (`0` to `100 %`) |
| `binary_sensor.kids_tasks_<child_id>_completed` | Binary Sensor | Per-child completion state (e.g. for אביב / דניאל) | `on` / `off` |
| `sensor.kids_tasks_<child_id>_remaining` | Sensor | Per-child count of remaining chores | Number |

> **Real-Time Sync:** These entities are created and updated instantly whenever any child or parent toggles a chore, when parent bypass is toggled, when children/tasks are modified, and on the daily reset.

### Parent TV Bypass & Bidirectional Real-Time Sync (מעקף הורים וסנכרון דו-כיווני 🔓)
Parents can temporarily or permanently allow TV viewing regardless of chore completion:
- **Toggle from Home Assistant:** Toggle `input_boolean.kids_tasks_parent_bypass` in your Lovelace dashboard, Home Assistant app, or automations.
  - **Instant WebSocket Push (<50ms):** Kids Tasker listens to Home Assistant's `state_changed` events over a persistent WebSocket connection. Any toggle in Home Assistant updates the Parent Dashboard (`/parent`) and the Kids Tablet (`/`) instantaneously via Socket.io without needing a page refresh!
- **Toggle from Parent Dashboard (`/parent`):** Toggle the dedicated **מעקף הורים לטלוויזיה** button in the Home Assistant tab. It updates Home Assistant via REST & service calls.
- **REST Webhook / Automation Support:** Home Assistant automations or webhooks can call `POST http://<kids-tasker-ip>:3000/api/hass/bypass` with `{ "state": "on" }` or `{ "state": "off" }`.
- When bypass is `on`:
  - `binary_sensor.kids_tasks_allow_tv` immediately changes to `on`.
  - Active TV blocking is suspended.
  - The tablet status banner displays `📺 טלוויזיה מותרת (מעקף הורים) 🔓`.
  - The Parent Dashboard status and Home Assistant tab reflect the active bypass state in real time.

---

### 1-Click Lovelace Dashboard Card (🎴 כרטיס דשבורד בלחיצה אחת)
You can automatically add a formatted, styled Lovelace card with all Kids Tasker entities directly to your Home Assistant dashboard!

1. In the Parent Dashboard ([http://localhost:3000/parent](http://localhost:3000/parent)), navigate to the **בית חכם (Home Assistant)** tab.
2. Scroll to **כרטיס לוח בקרה ל-Home Assistant (Lovelace Card)**.
3. Click **➕ הוסף כרטיס ל-Home Assistant בלחיצה אחת**.
   - Kids Tasker will connect to Home Assistant via its WebSocket API and automatically inject the card into your Lovelace dashboard!
   - Click **פתח דשבורד ב-Home Assistant ↗️** to view your new card immediately.
4. Alternatively, click **📋 העתק קוד כרטיס (YAML)** to copy the Lovelace YAML code and paste it manually into any custom view.

### Using in Home Assistant Automations:
You can use `binary_sensor.kids_tasks_allow_tv` directly as a trigger or condition in your Home Assistant automations:
```yaml
alias: "Turn off TV if chores are not completed"
trigger:
  - platform: state
    entity_id: switch.tv_socket
    to: "on"
condition:
  - condition: state
    entity_id: binary_sensor.kids_tasks_allow_tv
    state: "off"
action:
  - service: switch.turn_off
    target:
      entity_id: switch.tv_socket
  - service: notify.notify
    data:
      message: "הטלוויזיה נכבתה כיוון שעדיין נותרו משימות יומיות לביצוע!"
```

### Alternative: REST Sensor in `configuration.yaml`
If you prefer a polling REST sensor:
```yaml
sensor:
  - platform: rest
    name: "Kids Tasks Status"
    resource: "http://<YOUR-IP>:3000/api/hass/status"
    value_template: "{{ value_json.all_completed }}"
    json_attributes:
      - total_tasks
      - completed_tasks
      - remaining_tasks
      - tv_blocked
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
- **Kids Tablet Board:** [http://localhost:3000](http://localhost:3000)
- **Parent Management Dashboard:** [http://localhost:3000/parent](http://localhost:3000/parent)

### 3. Run Automated Tests
```bash
npm test
```

---

## API Reference

### Home Assistant
- `GET /api/hass/status`: Returns JSON status formatted for Home Assistant REST sensors (`all_completed`, `parent_bypass`, `total_tasks`, `completed_tasks`, `remaining_tasks`, `tv_blocked`, `children`).
- `GET /api/hass/config`: Get current Home Assistant configuration (token masked).
- `POST /api/hass/config`: Save Home Assistant configuration.
- `POST /api/hass/test`: Test connection and query entity state in Home Assistant.
- `POST /api/hass/bypass`: `{ enabled: true/false }` &rarr; Toggles parent TV bypass on/off and synchronizes with Home Assistant entity `input_boolean.kids_tasks_parent_bypass`.
- `POST /api/hass/create-entities`: Automatically creates and updates all virtual binary sensors and sensors in Home Assistant without manual configuration.
- `POST /api/hass/add-card`: Automatically injects or updates the Kids Tasker Lovelace card directly into Home Assistant via WebSocket.
- `GET /api/hass/card-yaml`: Returns the formatted Lovelace card YAML code and configuration object.

### Tasks & Daily Operations
- `GET /api/tasks`: Get full children and tasks data.
- `POST /api/tasks/toggle`: `{ childId, taskId, isParent?: boolean }` &rarr; Marks task as completed (or allows parent to revert back to pending). If a child tries to uncheck a completed task (`isParent: false`), returns HTTP 403. Syncs Home Assistant entities and emits `task_updated`.
- `POST /api/tasks/reset-day`: Resets all tasks to pending for the current day while preserving historical logs.
- `GET /api/history?date=YYYY-MM-DD`: Retrieve activity logs for a specific date or all dates.

### Children & Task CRUD
- `POST /api/children`: `{ name }` &rarr; creates child.
- `PUT /api/children/:id`: `{ name }` &rarr; updates child name.
- `DELETE /api/children/:id`: deletes child.
- `POST /api/children/:id/tasks`: `{ title, icon }` &rarr; adds task with icon to child.
- `PUT /api/children/:id/tasks/:taskId`: `{ title, icon }` &rarr; updates task title and/or icon.
- `DELETE /api/children/:id/tasks/:taskId`: deletes task.
