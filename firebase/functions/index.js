const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// 1. Daily Morning Reset (Runs at 04:00 AM every day)
exports.dailyReset = onSchedule('0 4 * * *', async (event) => {
  console.log('[DailyReset] Starting daily reset cron for all families...');
  
  try {
    const familiesSnapshot = await db.collection('families').get();
    const batch = db.batch();
    let count = 0;

    familiesSnapshot.forEach((doc) => {
      const data = doc.data();
      let updated = false;

      if (Array.isArray(data.children)) {
        data.children.forEach((child) => {
          if (Array.isArray(child.tasks)) {
            child.tasks.forEach((task) => {
              if (task.completed) {
                task.completed = false;
                task.completedAt = null;
                updated = true;
              }
            });
          }
        });
      }

      const updates = {
        children: data.children || [],
        lastActiveDate: new Date().toISOString().split('T')[0]
      };

      if (data.homeAssistant && data.homeAssistant.parentBypass) {
        updates['homeAssistant.parentBypass'] = false;
        updated = true;
      }

      if (updated) {
        batch.update(doc.ref, updates);
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      console.log(`[DailyReset] Successfully reset tasks for ${count} families.`);
    } else {
      console.log('[DailyReset] No families required resetting.');
    }
  } catch (error) {
    console.error('[DailyReset] Error during daily reset:', error);
  }
});

// 2. Home Assistant Parent Bypass Webhook
// POST /hassBypassWebhook
// Headers: Content-Type: application/json
// Body: { "familyId": "my-family", "enabled": true/false }
exports.hassBypassWebhook = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { familyId, enabled, state } = req.body || {};
  if (!familyId) {
    return res.status(400).json({ error: 'Missing familyId in body' });
  }

  const isEnabled = enabled !== undefined ? Boolean(enabled) : (state === 'on' || state === true);

  try {
    const familyRef = db.collection('families').doc(familyId);
    const snap = await familyRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: `Family "${familyId}" not found` });
    }

    await familyRef.update({
      'homeAssistant.parentBypass': isEnabled
    });

    console.log(`[HassWebhook] Set parentBypass to ${isEnabled} for family: ${familyId}`);
    return res.json({ success: true, familyId, parentBypass: isEnabled });
  } catch (error) {
    console.error('[HassWebhook] Error setting bypass:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
