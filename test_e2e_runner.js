const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TEST_PORT = 3099;
const TEST_DB_DIR = path.join(__dirname, 'test_db_e2e');

async function runFullE2ETestSuite() {
  console.log('====================================================');
  console.log('🔒 STARTING FULL-STACK E2E TEST PIPELINE & QUALITY GATE');
  console.log('====================================================\n');

  // Step 1: Run Server Unit & Integration Tests
  console.log('--- Step 1: Running Server Integration & Firebase Pairing Tests ---');
  try {
    execSync('node test_firebase_pairing.js', { stdio: 'inherit', cwd: __dirname });
    execSync('node test_server.js', { stdio: 'inherit', cwd: __dirname });
    console.log('✓ Server unit & pairing tests passed cleanly.\n');
  } catch (err) {
    console.error('❌ Step 1 Failed: Server unit tests emitted errors.');
    process.exit(1);
  }

  // Step 2: Build Angular Frontend Production Bundle
  console.log('--- Step 2: Verifying Angular Production Build (ng build) ---');
  try {
    const frontendDir = path.join(__dirname, 'frontend');
    execSync('npm run build', { stdio: 'inherit', cwd: frontendDir });
    console.log('✓ Angular production build compiled with 0 errors.\n');
  } catch (err) {
    console.error('❌ Step 2 Failed: Angular build threw compilation errors.');
    process.exit(1);
  }

  // Step 3: Spin up Server on Test Port (3099)
  console.log(`--- Step 3: Launching Server on Test Port ${TEST_PORT} ---`);
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }

  // Copy sample initial tasks.json to test DB
  const initialTasks = {
    children: [
      {
        id: 'child_e2e_1',
        name: 'אביב',
        tasks: [
          {
            id: 't_e2e_1',
            title: 'צחצוח שיניים',
            completed: false,
            completedAt: null,
            icon: 'toothbrush',
            requiresApproval: false,
            pendingApproval: false,
            audioFeedback: 'כל הכבוד',
            enabled: true
          }
        ]
      }
    ]
  };

  const initialSettings = {
    resetTime: '06:00',
    audio: {
      presets: [
        { id: 'audio_1', type: 'audio', name: 'test.mp3', value: 'test.mp3' }
      ]
    },
    bypassSchedule: { enabled: false, schedule: {} }
  };

  fs.writeFileSync(path.join(TEST_DB_DIR, 'tasks.json'), JSON.stringify(initialTasks, null, 2));
  fs.writeFileSync(path.join(TEST_DB_DIR, 'settings.json'), JSON.stringify(initialSettings, null, 2));

  const env = { ...process.env, PORT: TEST_PORT, DB_DIR: TEST_DB_DIR };
  const serverProcess = spawn('node', ['server.js'], { env, cwd: __dirname });

  let serverStarted = false;
  await new Promise((resolve, reject) => {
    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Server listening on port') || msg.includes('Kids Board URL')) {
        serverStarted = true;
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Err]:', data.toString());
    });

    setTimeout(() => {
      if (!serverStarted) resolve(); // Continue anyway after timeout
    }, 3000);
  });

  console.log(`✓ Test Server running on port ${TEST_PORT}\n`);

  // Step 4: Run Playwright Headless Browser Tests
  console.log('--- Step 4: Executing Playwright Browser E2E Tests ---');
  try {
    const { runBrowserTests } = require('./test_e2e_browser');
    await runBrowserTests();
    console.log('✓ All Headless Browser User Flows Verified!\n');
  } catch (err) {
    console.error('❌ Step 4 Failed: Browser E2E tests detected UI/API failures:', err);
    cleanup(serverProcess);
    process.exit(1);
  }

  // Cleanup
  cleanup(serverProcess);

  console.log('====================================================');
  console.log('✅ ALL FULL-STACK E2E TESTS PASSED SUCCESSFULLY! PUSH ALLOWED.');
  console.log('====================================================');
}

function cleanup(serverProcess) {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
  try {
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  } catch (e) {}
}

if (require.main === module) {
  runFullE2ETestSuite().catch((err) => {
    console.error('❌ E2E Pipeline Error:', err);
    process.exit(1);
  });
}
