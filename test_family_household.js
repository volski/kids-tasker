const assert = require('assert');
const {
  createHousehold,
  joinHouseholdByCode,
  getHouseholdInfo,
  getHouseholdIdForUser
} = require('./db_manager');

console.log('--- Starting Family Household Unit Tests ---');

// Test 1: Create Household
const ownerUid = 'parent_uid_1';
const ownerEmail = 'parent1@test.com';
const household1 = createHousehold(ownerUid, ownerEmail, 'משפחת ישראלי');

assert(household1.householdId, 'Household should have householdId');
assert.strictEqual(household1.name, 'משפחת ישראלי');
assert(household1.joinCode.startsWith('FAM-'), 'Join code should start with FAM-');
assert.strictEqual(household1.ownerUid, ownerUid);
assert(household1.members.includes(ownerUid), 'Owner should be in members');

console.log(`✓ Test 1: createHousehold created family "${household1.name}" with code ${household1.joinCode}`);

// Test 2: Household ID Resolution for owner
const resolvedId1 = getHouseholdIdForUser(ownerUid, ownerEmail);
assert.strictEqual(resolvedId1, household1.householdId, 'Owner should map to created householdId');

console.log(`✓ Test 2: getHouseholdIdForUser resolved owner to ${resolvedId1}`);

// Test 3: Join Household via Join Code
const memberUid = 'parent_uid_2';
const memberEmail = 'parent2@test.com';

const joinedHousehold = joinHouseholdByCode(memberUid, memberEmail, household1.joinCode);
assert.strictEqual(joinedHousehold.householdId, household1.householdId, 'Joined householdId must match');
assert(joinedHousehold.members.includes(memberUid), 'Second parent should be in members list');
assert.strictEqual(joinedHousehold.members.length, 2, 'Household should have 2 members');

console.log(`✓ Test 3: joinHouseholdByCode successfully added second parent (${memberEmail}) to family`);

// Test 4: Household ID Resolution for joined member
const resolvedId2 = getHouseholdIdForUser(memberUid, memberEmail);
assert.strictEqual(resolvedId2, household1.householdId, 'Member should map to shared householdId');

console.log(`✓ Test 4: Both parents now share householdId: ${resolvedId2}`);

// Test 5: Reject invalid join code
assert.throws(() => {
  joinHouseholdByCode('parent_uid_3', 'bad@test.com', 'FAM-999999');
}, /קוד הצטרפות לא תקין/);

console.log(`✓ Test 5: Invalid join code properly rejected with error`);

console.log('\n🌟 ALL FAMILY HOUSEHOLD TESTS PASSED! 🌟');
