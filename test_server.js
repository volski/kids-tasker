const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const TEST_PORT = 3461;
const MOCK_HASS_PORT = 8200;
const TEST_TASKS_FILE = path.join(__dirname, 'tasks.test.json');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const crypto = require('crypto');

// Mock Home Assistant Server
function createMockHassServer() {
  let tvState = 'on';
  let turnOffCalls = 0;
  const postedEntities = new Map();
  let savedLovelaceConfig = null;

  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      // 1. Health check: GET /api/
      if (req.method === 'GET' && req.url === '/api/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'API running.' }));
      }

      // 2. Entity state check: GET /api/states/<entity_id>
      if (req.method === 'GET' && req.url.startsWith('/api/states/')) {
        const entityId = req.url.replace('/api/states/', '');
        const existing = postedEntities.get(entityId);
        if (existing) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(existing));
        }
        if (entityId === 'switch.living_room_tv') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            entity_id: 'switch.living_room_tv',
            state: tvState,
            attributes: { friendly_name: 'טלוויזיה בסלון' }
          }));
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Entity not found' }));
      }

      // 3. Post / Create Entity state: POST /api/states/<entity_id>
      if (req.method === 'POST' && req.url.startsWith('/api/states/')) {
        const entityId = req.url.replace('/api/states/', '');
        try {
          const parsed = JSON.parse(body);
          postedEntities.set(entityId, { entity_id: entityId, ...parsed });
        } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ entity_id: entityId, state: 'ok' }));
      }

      // 4. Service call: POST /api/services/homeassistant/turn_off
      if (req.method === 'POST' && req.url === '/api/services/homeassistant/turn_off') {
        turnOffCalls++;
        tvState = 'off';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ entity_id: 'switch.living_room_tv', state: 'off' }]));
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found in mock' }));
    });
  });

  // WebSocket Server for Home Assistant Lovelace commands and event subscriptions
  const eventSubscribers = [];

  mockServer.on('upgrade', (req, socket) => {
    socket.on('error', () => {});
    socket.on('close', () => {
      const idx = eventSubscribers.findIndex(s => s.socket === socket);
      if (idx >= 0) eventSubscribers.splice(idx, 1);
    });

    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');

    const send = (msg) => {
      const buf = Buffer.from(JSON.stringify(msg));
      let header;
      if (buf.length < 126) {
        header = Buffer.from([0x81, buf.length]);
      } else {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(buf.length, 2);
      }
      socket.write(Buffer.concat([header, buf]));
    };

    send({ type: 'auth_required', ha_version: '2024.1.0' });

    socket.on('data', (buf) => {
      try {
        if (buf.length < 6) return;
        const masked = (buf[1] & 0x80) === 0x80;
        let len = buf[1] & 0x7F;
        let offset = 2;
        if (len === 126) {
          len = buf.readUInt16BE(2);
          offset = 4;
        }
        if (masked && len > 0) {
          const mask = buf.slice(offset, offset + 4);
          offset += 4;
          const payload = Buffer.alloc(len);
          for (let i = 0; i < len; i++) {
            payload[i] = buf[offset + i] ^ mask[i % 4];
          }
          const clientMsg = JSON.parse(payload.toString());

          if (clientMsg.type === 'auth') {
            send({ type: 'auth_ok', ha_version: '2024.1.0' });
          } else if (clientMsg.type === 'subscribe_events') {
            eventSubscribers.push({ socket, send, subId: clientMsg.id, event_type: clientMsg.event_type });
            send({
              id: clientMsg.id,
              type: 'result',
              success: true,
              result: null
            });
          } else if (clientMsg.type === 'input_boolean/list') {
            send({
              id: clientMsg.id,
              type: 'result',
              success: true,
              result: [{ id: 'kids_tasks_parent_bypass', name: 'kids_tasks_parent_bypass' }]
            });
          } else if (clientMsg.type === 'input_boolean/create') {
            send({
              id: clientMsg.id,
              type: 'result',
              success: true,
              result: { id: clientMsg.name, name: clientMsg.name }
            });
          } else if (clientMsg.type === 'lovelace/config') {
            send({
              id: clientMsg.id,
              type: 'result',
              success: true,
              result: savedLovelaceConfig || { title: 'Home', views: [{ title: 'Home', cards: [] }] }
            });
          } else if (clientMsg.type === 'lovelace/config/save') {
            savedLovelaceConfig = clientMsg.config;
            send({
              id: clientMsg.id,
              type: 'result',
              success: true,
              result: null
            });
          }
        }
      } catch (e) {
        console.error('Mock WS error:', e);
      }
    });
  });

  return {
    server: mockServer,
    getStats: () => ({ turnOffCalls, tvState, postedEntities }),
    getLovelaceConfig: () => savedLovelaceConfig,
    setTvState: (s) => { tvState = s; },
    emitStateChanged: (entityId, newState, oldState = 'off') => {
      const existing = postedEntities.get(entityId) || { entity_id: entityId };
      postedEntities.set(entityId, { ...existing, state: newState });
      for (const sub of eventSubscribers) {
        try {
          sub.send({
            id: sub.subId,
            type: 'event',
            event: {
              event_type: 'state_changed',
              data: {
                entity_id: entityId,
                new_state: { entity_id: entityId, state: newState },
                old_state: { entity_id: entityId, state: oldState }
              }
            }
          });
        } catch (e) {}
      }
    }
  };
}

async function runTests() {
  console.log('--- Starting Automatic Home Assistant Entity Creation Tests ---');

  if (fs.existsSync(TEST_TASKS_FILE)) {
    fs.unlinkSync(TEST_TASKS_FILE);
  }

  // 1. Start Mock Home Assistant Server
  const mockHass = createMockHassServer();
  await new Promise(resolve => mockHass.server.listen(MOCK_HASS_PORT, resolve));
  console.log(`✓ Mock Home Assistant server listening on port ${MOCK_HASS_PORT}`);

  // 2. Start kids-tasker server
  const serverProcess = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: TEST_PORT.toString(), TASKS_FILE: TEST_TASKS_FILE },
    stdio: 'pipe'
  });

  serverProcess.stderr.on('data', (d) => {
    console.error(`[Server Error]: ${d.toString().trim()}`);
  });

  await delay(1500);

  try {
    // 3. Save Home Assistant Config to connect to our mock
    const saveConfigRes = await fetch(`http://localhost:${TEST_PORT}/api/hass/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        url: `http://localhost:${MOCK_HASS_PORT}`,
        token: 'mock-token-abc123xyz',
        tvEntityId: 'switch.living_room_tv',
        autoBlockTv: true
      })
    });
    if (saveConfigRes.status !== 200) throw new Error('Failed to save config');
    console.log('✓ Home Assistant configured & enabled');

    // 4. Test POST /api/hass/create-entities (Automatic Entity Creation)
    const createEntitiesRes = await fetch(`http://localhost:${TEST_PORT}/api/hass/create-entities`, {
      method: 'POST'
    });
    if (createEntitiesRes.status !== 200) throw new Error('POST /api/hass/create-entities failed');
    const createResult = await createEntitiesRes.json();

    if (!createResult.success || !Array.isArray(createResult.entities) || createResult.entities.length < 5) {
      throw new Error(`Expected at least 5 entities created, got: ${JSON.stringify(createResult)}`);
    }
    console.log(`✓ POST /api/hass/create-entities created and returned ${createResult.entities.length} entities!`);

    // Verify entities were actually posted to Home Assistant mock
    const { postedEntities } = mockHass.getStats();

    // Check 1: binary_sensor.kids_tasks_allow_tv
    const allowTvEntity = postedEntities.get('binary_sensor.kids_tasks_allow_tv');
    if (!allowTvEntity || allowTvEntity.state !== 'off') {
      throw new Error(`Expected binary_sensor.kids_tasks_allow_tv state 'off', got: ${allowTvEntity && allowTvEntity.state}`);
    }
    console.log('✓ Verified automatic creation of "binary_sensor.kids_tasks_allow_tv" (state: off)');

    // Check 2: input_boolean.kids_tasks_allow_tv
    const inputBoolEntity = postedEntities.get('input_boolean.kids_tasks_allow_tv');
    if (!inputBoolEntity || inputBoolEntity.state !== 'off') {
      throw new Error(`Expected input_boolean.kids_tasks_allow_tv state 'off'`);
    }
    console.log('✓ Verified automatic creation of "input_boolean.kids_tasks_allow_tv"');

    // Check 3: binary_sensor.kids_tasks_completed
    const completedEntity = postedEntities.get('binary_sensor.kids_tasks_completed');
    if (!completedEntity || completedEntity.state !== 'off') {
      throw new Error(`Expected binary_sensor.kids_tasks_completed state 'off'`);
    }
    console.log('✓ Verified automatic creation of "binary_sensor.kids_tasks_completed"');

    // Check 4: sensor.kids_tasks_remaining
    const remainingSensor = postedEntities.get('sensor.kids_tasks_remaining');
    if (!remainingSensor || Number(remainingSensor.state) <= 0) {
      throw new Error(`Expected sensor.kids_tasks_remaining to be positive number`);
    }
    console.log(`✓ Verified automatic creation of "sensor.kids_tasks_remaining" (remaining: ${remainingSensor.state})`);

    // Check 5: per-child sensors
    const child1Entity = postedEntities.get('binary_sensor.kids_tasks_child_1_completed');
    if (!child1Entity) {
      throw new Error('Expected per-child entity "binary_sensor.kids_tasks_child_1_completed" to be created');
    }
    console.log(`✓ Verified automatic creation of per-child entity "${child1Entity.entity_id}" (${child1Entity.attributes.friendly_name})`);

    // 5. Complete all tasks and verify automatic state update in Home Assistant entities
    const tasksRes = await fetch(`http://localhost:${TEST_PORT}/api/tasks`);
    const tasksData = await tasksRes.json();
    for (const child of tasksData.children) {
      for (const t of child.tasks) {
        if (!t.completed) {
          await fetch(`http://localhost:${TEST_PORT}/api/tasks/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childId: child.id, taskId: t.id })
          });
        }
      }
    }

    await delay(600);

    // Verify binary_sensor.kids_tasks_allow_tv flipped to 'on'
    const updatedAllowTv = mockHass.getStats().postedEntities.get('binary_sensor.kids_tasks_allow_tv');
    if (!updatedAllowTv || updatedAllowTv.state !== 'on') {
      throw new Error(`Expected binary_sensor.kids_tasks_allow_tv to automatically flip to 'on', got ${updatedAllowTv && updatedAllowTv.state}`);
    }
    console.log('✓ Verified automatic real-time sync: binary_sensor.kids_tasks_allow_tv flipped to "on" upon chore completion!');

    // 5b. Test: Kid cannot revert completed task back to pending (HTTP 403)
    const kidRevertRes = await fetch(`http://localhost:${TEST_PORT}/api/tasks/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: 'child_1', taskId: 't1', isParent: false })
    });
    if (kidRevertRes.status !== 403) {
      throw new Error(`Expected HTTP 403 when kid uncompletes task, got ${kidRevertRes.status}`);
    }
    console.log('✓ Verified kids cannot uncomplete a task (HTTP 403 restricted to parents)');

    // 5c. Test: Parent CAN revert completed task back to pending (HTTP 200)
    const parentRevertRes = await fetch(`http://localhost:${TEST_PORT}/api/tasks/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: 'child_1', taskId: 't1', isParent: true })
    });
    if (parentRevertRes.status !== 200) {
      throw new Error(`Expected HTTP 200 when parent uncompletes task, got ${parentRevertRes.status}`);
    }
    console.log('✓ Verified parents can revert completed tasks (isParent: true)');

    await delay(300);

    // Since child_1.t1 is now pending again, binary_sensor.kids_tasks_allow_tv should be 'off'
    const allowTvPending = mockHass.getStats().postedEntities.get('binary_sensor.kids_tasks_allow_tv');
    if (!allowTvPending || allowTvPending.state !== 'off') {
      throw new Error(`Expected allow_tv to be 'off' when chores are pending, got ${allowTvPending && allowTvPending.state}`);
    }

    // 5d. Test: Parent TV Bypass in Home Assistant
    const bypassOnRes = await fetch(`http://localhost:${TEST_PORT}/api/hass/bypass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    });
    if (bypassOnRes.status !== 200) throw new Error('POST /api/hass/bypass failed');
    const bypassOnData = await bypassOnRes.json();
    if (!bypassOnData.success || !bypassOnData.parentBypass) {
      throw new Error('Failed to enable parent bypass');
    }

    await delay(300);

    // Verify parent bypass flipped binary_sensor.kids_tasks_allow_tv to 'on' even with pending chores!
    const allowTvBypassed = mockHass.getStats().postedEntities.get('binary_sensor.kids_tasks_allow_tv');
    if (!allowTvBypassed || allowTvBypassed.state !== 'on') {
      throw new Error(`Expected binary_sensor.kids_tasks_allow_tv to be 'on' via parent bypass, got ${allowTvBypassed && allowTvBypassed.state}`);
    }
    console.log('✓ Verified Home Assistant Parent Bypass: binary_sensor.kids_tasks_allow_tv flipped to "on" while chores pending!');

    // Verify input_boolean.kids_tasks_parent_bypass entity was synced in Home Assistant mock
    const bypassEntity = mockHass.getStats().postedEntities.get('input_boolean.kids_tasks_parent_bypass');
    if (!bypassEntity || bypassEntity.state !== 'on') {
      throw new Error('Expected input_boolean.kids_tasks_parent_bypass to be "on" in Home Assistant');
    }
    console.log('✓ Verified automatic creation and state sync of "input_boolean.kids_tasks_parent_bypass" in Home Assistant');

    // 6. Test GET /api/hass/card-yaml
    const cardYamlRes = await fetch(`http://localhost:${TEST_PORT}/api/hass/card-yaml`);
    if (cardYamlRes.status !== 200) throw new Error('GET /api/hass/card-yaml failed');
    const cardYamlData = await cardYamlRes.json();
    if (!cardYamlData.success || !cardYamlData.yaml || !cardYamlData.card) {
      throw new Error('Expected valid card YAML and card object');
    }
    if (!cardYamlData.yaml.includes('binary_sensor.kids_tasks_allow_tv') || !cardYamlData.yaml.includes('input_boolean.kids_tasks_parent_bypass')) {
      throw new Error('Generated YAML missing required entities or parent bypass');
    }
    console.log('✓ Verified GET /api/hass/card-yaml returns valid Lovelace YAML configuration (includes parent bypass)');

    // 7. Test POST /api/hass/add-card (Automatic 1-Click Lovelace Card Injection via WebSocket)
    const addCardRes = await fetch(`http://localhost:${TEST_PORT}/api/hass/add-card`, {
      method: 'POST'
    });
    if (addCardRes.status !== 200) {
      const errText = await addCardRes.text();
      throw new Error(`POST /api/hass/add-card failed: ${errText}`);
    }
    const addCardResult = await addCardRes.json();
    if (!addCardResult.success || !addCardResult.path) {
      throw new Error(`Expected success from add-card, got: ${JSON.stringify(addCardResult)}`);
    }

    // Verify card was received by mock Home Assistant server and saved to Lovelace
    const savedConfig = mockHass.getLovelaceConfig();
    if (!savedConfig || !savedConfig.views || savedConfig.views.length === 0) {
      throw new Error('Lovelace configuration was not saved to Home Assistant');
    }
    const injectedCard = savedConfig.views[0].cards.find(c => c.title && c.title.includes('Kids Tasker'));
    if (!injectedCard) {
      throw new Error('Kids Tasker card was not found in saved Lovelace dashboard view');
    }
    // 8. Test: Real-Time Bidirectional State Sync from Home Assistant via WebSocket
    console.log('--- Testing Real-Time Bidirectional State Sync from Home Assistant ---');
    
    // Connect Socket.io client to verify instant dashboard push
    const clientSocket = io(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise((resolve, reject) => {
      clientSocket.on('connect', resolve);
      clientSocket.on('connect_error', reject);
    });
    console.log('✓ Connected test Socket.io client to Kids Tasker');

    // Wait a brief moment to ensure kids-tasker's WebSocket listener is connected to mockHass
    await delay(600);

    // 8a. Simulate Home Assistant toggling parent bypass to 'off'
    let receivedUpdatePromise = new Promise(resolve => {
      const handler = (updated) => {
        if (updated.homeAssistant && updated.homeAssistant.parentBypass === false) {
          clientSocket.off('task_updated', handler);
          resolve(updated);
        }
      };
      clientSocket.on('task_updated', handler);
    });

    mockHass.emitStateChanged('input_boolean.kids_tasks_parent_bypass', 'off', 'on');

    const updatedDataOff = await Promise.race([
      receivedUpdatePromise,
      delay(3000).then(() => { throw new Error('Timeout waiting for task_updated socket event after HA turned bypass OFF'); })
    ]);

    if (updatedDataOff.homeAssistant.parentBypass !== false) {
      throw new Error('Expected parentBypass to be false after HA event');
    }
    console.log('✓ Verified: Home Assistant turning bypass OFF pushed real-time update via WebSocket & Socket.io!');

    await delay(400);
    const allowTvAfterOff = mockHass.getStats().postedEntities.get('binary_sensor.kids_tasks_allow_tv');
    if (!allowTvAfterOff || allowTvAfterOff.state !== 'off') {
      throw new Error(`Expected binary_sensor.kids_tasks_allow_tv to be 'off', got ${allowTvAfterOff && allowTvAfterOff.state}`);
    }
    console.log('✓ Verified: binary_sensor.kids_tasks_allow_tv automatically flipped to "off" in HA!');

    // 8b. Simulate Home Assistant toggling parent bypass back to 'on'
    receivedUpdatePromise = new Promise(resolve => {
      const handler = (updated) => {
        if (updated.homeAssistant && updated.homeAssistant.parentBypass === true) {
          clientSocket.off('task_updated', handler);
          resolve(updated);
        }
      };
      clientSocket.on('task_updated', handler);
    });

    mockHass.emitStateChanged('input_boolean.kids_tasks_parent_bypass', 'on', 'off');

    const updatedDataOn = await Promise.race([
      receivedUpdatePromise,
      delay(3000).then(() => { throw new Error('Timeout waiting for task_updated socket event after HA turned bypass ON'); })
    ]);

    if (updatedDataOn.homeAssistant.parentBypass !== true) {
      throw new Error('Expected parentBypass to be true after HA event');
    }
    console.log('✓ Verified: Home Assistant turning bypass ON pushed real-time update via WebSocket & Socket.io!');

    await delay(400);
    const allowTvAfterOn = mockHass.getStats().postedEntities.get('binary_sensor.kids_tasks_allow_tv');
    if (!allowTvAfterOn || allowTvAfterOn.state !== 'on') {
      throw new Error(`Expected binary_sensor.kids_tasks_allow_tv to be 'on', got ${allowTvAfterOn && allowTvAfterOn.state}`);
    }
    console.log('✓ Verified: binary_sensor.kids_tasks_allow_tv automatically flipped to "on" in HA!');

    // 8c. Test POST /api/hass/bypass with { state: 'off' } (Home Assistant REST / Webhook format)
    const restBypassRes = await fetch(`http://localhost:${TEST_PORT}/api/hass/bypass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'off' })
    });
    if (restBypassRes.status !== 200) throw new Error('POST /api/hass/bypass with { state: "off" } failed');
    const restBypassResult = await restBypassRes.json();
    if (restBypassResult.parentBypass !== false) {
      throw new Error('Expected parentBypass to be false from { state: "off" }');
    }
    console.log('✓ Verified POST /api/hass/bypass accepts Home Assistant webhook payload ({ state: "off" })');

    clientSocket.disconnect();

    console.log('\n🌟 ALL TESTS PASSED: BIDIRECTIONAL REAL-TIME SYNC + PARENT BYPASS + LOVELACE INJECTION! 🌟');
  } finally {
    try { serverProcess.kill(); } catch (e) {}
    try { mockHass.server.close(); } catch (e) {}
    if (fs.existsSync(TEST_TASKS_FILE)) {
      fs.unlinkSync(TEST_TASKS_FILE);
    }
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
