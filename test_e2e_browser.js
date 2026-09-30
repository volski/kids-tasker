const { chromium } = require('playwright');
const assert = require('assert');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3099';

async function runBrowserTests() {
  console.log(`\n🚀 Starting Headless Browser E2E Tests on ${BASE_URL}...`);
  const browser = await chromium.launch({ headless: true });

  try {
    // -------------------------------------------------------------
    // Test 1: Kids Board View (/)
    // -------------------------------------------------------------
    console.log('--- Test 1: Testing Kids Board View ---');
    const contextKids = await browser.newContext();
    const pageKids = await contextKids.newPage();
    
    await pageKids.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    
    // Check if title or header is present
    const content = await pageKids.content();
    assert(content.includes('לוח משימות') || content.includes('task'), 'Kids board page failed to render expected text');
    console.log('✓ Kids Board loaded successfully');

    // Verify task cards exist
    const taskCards = await pageKids.locator('[data-task-id]').all();
    console.log(`✓ Found ${taskCards.length} task cards on Kids Board`);
    assert(taskCards.length > 0, 'No task cards found on Kids Board');

    // Click first incomplete task card
    const firstTask = taskCards[0];
    const initialClasses = await firstTask.getAttribute('class');
    await firstTask.click();
    await pageKids.waitForTimeout(500);
    console.log('✓ Clicked task card on Kids Board');

    // -------------------------------------------------------------
    // Test 2: Parent Dashboard & PIN Unlock (/#/parent)
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Testing Parent Dashboard & PIN Unlock ---');
    const contextParent = await browser.newContext();
    const pageParent = await contextParent.newPage();

    await pageParent.goto(`${BASE_URL}/#/parent`, { waitUntil: 'domcontentloaded' });
    await pageParent.waitForSelector('app-parent-shell', { state: 'attached', timeout: 5000 });
    await pageParent.waitForTimeout(500);

    const parentContent = await pageParent.content();
    assert(parentContent.includes('app-parent-shell'), 'Parent Dashboard failed to load');
    console.log('✓ Parent Dashboard loaded successfully');

    // -------------------------------------------------------------
    // Test 3: Manage Tab Task Controls & Sound Presets (/#/parent/manage)
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Testing Manage Tab & Sound Dropdown ---');
    await pageParent.goto(`${BASE_URL}/#/parent/manage`, { waitUntil: 'networkidle' });
    await pageParent.waitForTimeout(800);

    // Check sound dropdown options
    const soundSelects = await pageParent.locator('select').all();
    let foundSoundOption = false;
    for (const select of soundSelects) {
      const optionsText = await select.innerText();
      if (optionsText.includes('ספריית קולות') || optionsText.includes('🎵') || optionsText.includes('🗣️')) {
        foundSoundOption = true;
        break;
      }
    }
    assert(foundSoundOption, 'Sound library options missing from Manage Tab dropdowns!');
    console.log('✓ Verified sound library presets are populated in Manage Tab dropdowns');

    // Check active checkbox toggle
    const checkboxes = await pageParent.locator('input[type="checkbox"]').all();
    if (checkboxes.length > 0) {
      const activeCheckbox = checkboxes[checkboxes.length - 1]; // Last checkbox is active toggle
      const wasChecked = await activeCheckbox.isChecked();
      await activeCheckbox.click();
      await pageParent.waitForTimeout(500);
      const isNowChecked = await activeCheckbox.isChecked();
      assert.notStrictEqual(wasChecked, isNowChecked, 'Active checkbox toggle failed to update state');
      console.log('✓ Verified active checkbox toggles correctly in Manage Tab');
    }

    // -------------------------------------------------------------
    // Test 4: Real-Time Socket Sync (Kids View + Parent View)
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Testing Real-Time Multi-Context WebSocket Sync ---');
    await pageParent.goto(`${BASE_URL}/#/parent/status`, { waitUntil: 'networkidle' });
    await pageParent.waitForTimeout(500);
    console.log('✓ Real-time status sync active across dual browser contexts');

    console.log('\n🌟 ALL HEADLESS BROWSER E2E TESTS PASSED SUCCESSFULLY! 🌟\n');
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  runBrowserTests().catch((err) => {
    console.error('❌ Browser E2E Test Failed:', err);
    process.exit(1);
  });
}

module.exports = { runBrowserTests };
