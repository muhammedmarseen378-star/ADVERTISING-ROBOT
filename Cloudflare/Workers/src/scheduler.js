// ============================================================================
// Cloudflare Workers Server-Side Advertisement Scheduler
// Automated ad evaluation using Cloudflare Cron Triggers & Asia/Kolkata Timezone
// ============================================================================

import { generateRandomHex } from './crypto.js';
import { jsonResponse } from './auth.js';

/**
 * Get current ISO time string in Asia/Kolkata (IST = UTC + 5:30)
 */
export function getKolkataTime() {
  const now = new Date();
  // Format to Asia/Kolkata YYYY-MM-DD HH:mm:ss
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(now).replace(',', '');
}

/**
 * Core Scheduler Evaluation Function
 * Runs via Cloudflare Cron Trigger (every 60 seconds) or via manual API trigger
 */
export async function evaluateAdvertisementSchedules(env) {
  const currentTimeKolkata = getKolkataTime();
  const nowUtc = new Date().toISOString();

  // Find all active schedules valid for the current time
  // Matches start_time <= current AND end_time >= current AND is_active = 1
  const validSchedules = await env.DB.prepare(`
    SELECT s.id as schedule_id, s.priority as schedule_priority, s.duration_sec,
           a.id as ad_id, a.title, a.priority as ad_priority, a.status, a.display_page_id
    FROM advertisement_schedules s
    JOIN advertisements a ON s.advertisement_id = a.id
    WHERE s.is_active = 1 
      AND a.status != 'paused' 
      AND a.status != 'draft'
      AND s.start_time <= ? 
      AND s.end_time >= ?
    ORDER BY s.priority DESC, a.priority DESC, s.start_time ASC
  `).bind(currentTimeKolkata, currentTimeKolkata).all();

  const candidates = validSchedules.results || [];

  if (candidates.length === 0) {
    // If no specific schedule matches current time window, pick default active or highest priority scheduled ad
    const fallbackAd = await env.DB.prepare(`
      SELECT id, title, display_page_id, status FROM advertisements 
      WHERE status != 'paused' AND status != 'draft' 
      ORDER BY priority DESC, updated_at DESC LIMIT 1
    `).first();

    if (fallbackAd && fallbackAd.status !== 'active') {
      await activateAd(env, fallbackAd.id, fallbackAd.title, fallbackAd.display_page_id || 1, 'FALLBACK_SCHEDULE');
      return { action: 'ACTIVATED_FALLBACK', adId: fallbackAd.id };
    }
    return { action: 'NO_CANDIDATE_FOUND', message: 'Current active ad maintained.' };
  }

  // Winning candidate is the highest priority ad (index 0)
  const winner = candidates[0];

  // Get currently active ad from system_settings
  const activeSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'active_ad_id'").first();
  const currentActiveAdId = activeSetting ? activeSetting.value : null;

  // Idempotency: If the winner is already active, do nothing
  if (currentActiveAdId === winner.ad_id) {
    return { action: 'ALREADY_ACTIVE', adId: winner.ad_id, title: winner.title };
  }

  // Otherwise, activate the new winner
  await activateAd(env, winner.ad_id, winner.title, winner.display_page_id || 1, 'SCHEDULED_TRANSITION');

  return {
    action: 'SWITCHED_ADVERTISEMENT',
    previousAdId: currentActiveAdId,
    newAdId: winner.ad_id,
    title: winner.title,
    pageId: winner.display_page_id || 1,
    time: currentTimeKolkata
  };
}

/**
 * Helper to activate an advertisement and notify ESP32 robot
 */
async function activateAd(env, adId, title, pageId, triggerType) {
  const currentActive = await env.DB.prepare("SELECT id FROM advertisements WHERE status = 'active'").first();

  await env.DB.batch([
    // Update statuses
    env.DB.prepare("UPDATE advertisements SET status = 'scheduled' WHERE status = 'active'"),
    env.DB.prepare("UPDATE advertisements SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(adId),
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('active_ad_id', ?)").bind(adId),
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('active_ad_page_id', ?)").bind(String(pageId)),
    // Record in history
    env.DB.prepare(`
      INSERT INTO advertisement_history (id, advertisement_id, activation_time, previous_ad_id, trigger_type, details)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `).bind(
      generateRandomHex(16),
      adId,
      currentActive?.id || null,
      triggerType,
      `Automatic schedule switch: Activated "${title}" (DWIN Page ${pageId})`
    )
  ]);

  // Push SYNC_AD command for the ESP32 Main Controller
  const commandId = `cmd_${generateRandomHex(8)}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  await env.DB.prepare(`
    INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
    VALUES (?, 'ESP32_MAIN_ROBOT_01', 'SYNC_AD', ?, 'PENDING', ?)
  `).bind(commandId, JSON.stringify({ adId, pageId }), expiresAt).run();
}

/**
 * POST /api/schedules/evaluate (Admin trigger or testing)
 */
export async function handleEvaluateScheduleApi(request, env) {
  const result = await evaluateAdvertisementSchedules(env);
  return jsonResponse({ success: true, evaluation: result });
}

/**
 * GET /api/schedules (List all schedule rules)
 */
export async function handleListSchedules(request, env) {
  const schedules = await env.DB.prepare(`
    SELECT s.*, a.title as ad_title, a.poster_url, a.display_page_id
    FROM advertisement_schedules s
    JOIN advertisements a ON s.advertisement_id = a.id
    ORDER BY s.priority DESC, s.start_time ASC
  `).all();

  return jsonResponse({ schedules: schedules.results || [] });
}
