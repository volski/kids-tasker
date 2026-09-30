const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DB_DIR = path.join(__dirname, 'test_db_pairing');

// Clean test db dir
if (fs.existsSync(process.env.DB_DIR)) {
  fs.rmSync(process.env.DB_DIR, { recursive: true, force: true });
}

const {
  initPairingSession,
  pairDevice,
  getDeviceByToken,
  getHouseholdDevices,
  revokeDevice,
  readHouseholdTasks,
  writeHouseholdTasks
} = require('./db_manager');

async function runTests() {
  console.log('--- Starting Multi-Tenant & QR Device Pairing Integration Tests ---');

  // Test 1: Init Pairing Session
  const session = initPairingSession('127.0.0.1', 'TestTV/1.0');
  assert.ok(session.sessionId, 'Session ID should exist');
  assert.ok(session.code.startsWith('KIDS-'), 'Pairing code format should be KIDS-XXXX');
  assert.strictEqual(session.status, 'pending');
  console.log('✓ Test 1: initPairingSession generated valid code:', session.code);

  // Test 2: Pair Device to Household
  const householdId = 'house_test_123';
  const paired = pairDevice(session.code, householdId, 'Living Room Smart TV');
  assert.ok(paired.deviceToken.startsWith('dev_tok_'), 'Device token should be issued');
  assert.strictEqual(paired.householdId, householdId);
  assert.strictEqual(paired.deviceName, 'Living Room Smart TV');
  console.log('✓ Test 2: pairDevice bound code to household:', householdId);

  // Test 3: Validate Device Token Authorization
  const dev = getDeviceByToken(paired.deviceToken);
  assert.ok(dev, 'Device should be found by token');
  assert.strictEqual(dev.status, 'allowed');
  assert.strictEqual(dev.householdId, householdId);
  console.log('✓ Test 3: getDeviceByToken validated allowed status');

  // Test 4: Retrieve Household Allowed Devices List
  const devList = getHouseholdDevices(householdId);
  assert.strictEqual(devList.length, 1);
  assert.strictEqual(devList[0].deviceName, 'Living Room Smart TV');
  console.log('✓ Test 4: getHouseholdDevices returned 1 paired device');

  // Test 5: Revoke Device Access
  const revoked = revokeDevice(paired.deviceId, householdId);
  assert.strictEqual(revoked.status, 'revoked');
  
  const devAfterRevoke = getDeviceByToken(paired.deviceToken);
  assert.strictEqual(devAfterRevoke, null, 'Revoked device token must return null');
  console.log('✓ Test 5: revokeDevice invalidated device access instantly');

  // Test 6: Household Multi-Tenant Data Separation
  const houseA = 'house_alpha';
  const houseB = 'house_beta';

  const defaultDataA = { children: [{ id: 'c1', name: 'Child Alpha', tasks: [] }] };
  const defaultDataB = { children: [{ id: 'c2', name: 'Child Beta', tasks: [] }] };

  writeHouseholdTasks(houseA, defaultDataA);
  writeHouseholdTasks(houseB, defaultDataB);

  const readA = readHouseholdTasks(houseA);
  const readB = readHouseholdTasks(houseB);

  assert.strictEqual(readA.children[0].name, 'Child Alpha');
  assert.strictEqual(readB.children[0].name, 'Child Beta');
  console.log('✓ Test 6: Multi-tenant household data isolation verified');

  // Test 7: Verify new household starts with empty children array []
  const houseNew = 'house_fresh_new';
  const readNew = readHouseholdTasks(houseNew, { children: [] });
  assert.ok(Array.isArray(readNew.children), 'Children must be array');
  assert.strictEqual(readNew.children.length, 0, 'New household must start with 0 kids entries');
  console.log('✓ Test 7: Verified new household starts completely clean with children: []');

  // Cleanup test DB
  if (fs.existsSync(process.env.DB_DIR)) {
    fs.rmSync(process.env.DB_DIR, { recursive: true, force: true });
  }

  console.log('\n🌟 ALL MULTI-TENANT & DEVICE PAIRING TESTS PASSED! 🌟');
}

runTests().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
