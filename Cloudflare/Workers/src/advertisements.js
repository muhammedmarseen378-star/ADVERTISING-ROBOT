// ============================================================================
// Cloudflare Workers Advertisement Management & History Module
// Supports Public Kiosk, DWIN HMI Synchronization, Play Now, and Priority Controls
// ============================================================================

import { authenticateAdmin, jsonResponse } from './auth.js';
import { generateRandomHex } from './crypto.js';

/**
 * GET /api/advertisements
 * Admin endpoint: retrieves all advertisements with product metadata
 */
export async function handleListAdvertisements(request, env) {
  const ads = await env.DB.prepare(`
    SELECT a.*, p.name as product_name, c.name as category_name,
           s.start_time, s.end_time, s.duration_sec, s.is_active as schedule_active
    FROM advertisements a
    LEFT JOIN products p ON a.product_id = p.id
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN advertisement_schedules s ON a.id = s.advertisement_id
    ORDER BY a.priority DESC, a.updated_at DESC
  `).all();

  return jsonResponse({ advertisements: ads.results || [] });
}

/**
 * GET /api/advertisements/active
 * Public endpoint consumed by Public Kiosk and ESP32-S3 Main Controller
 */
export async function handleGetActiveAdvertisement(request, env) {
  // 1. Check if there is an active advertisement
  let activeAd = await env.DB.prepare(`
    SELECT a.*, p.name as product_name, p.specs_json, p.faq_json, p.availability,
           c.name as category_name
    FROM advertisements a
    LEFT JOIN products p ON a.product_id = p.id
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.status = 'active'
    ORDER BY a.priority DESC, a.updated_at DESC
    LIMIT 1
  `).first();

  // 2. If none marked active, get the top priority scheduled ad
  if (!activeAd) {
    activeAd = await env.DB.prepare(`
      SELECT a.*, p.name as product_name, p.specs_json, p.faq_json, p.availability,
             c.name as category_name
      FROM advertisements a
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.status != 'draft' AND a.status != 'paused'
      ORDER BY a.priority DESC, a.updated_at DESC
      LIMIT 1
    `).first();
  }

  // 3. Fallback welcome message if database has no active ad
  if (!activeAd) {
    return jsonResponse({
      id: 'welcome_default',
      title: 'Welcome to AI Advertisement Robot',
      category_name: 'Electronics & Robotics',
      poster_url: '/assets/ads/gaming_laptop.svg',
      short_desc: 'Autonomous Smart Advertisement Robot',
      short_desc_ml: 'ഓട്ടോണമസ് സ്മാർട്ട് പരസ്യ റോബോട്ട്',
      detailed_desc: 'Next-generation autonomous customer engagement and advertising system.',
      price: null,
      features: 'AI Voice Assistant • Autonomous Navigation • DWIN HMI Display',
      promo_info: 'Special Launch Offer 2026',
      display_page_id: 1,
      status: 'active',
      robot_online: false
    });
  }

  // Parse JSON features/specs if needed
  let parsedSpecs = {};
  try {
    if (activeAd.specs_json) parsedSpecs = JSON.parse(activeAd.specs_json);
  } catch {}

  return jsonResponse({
    ...activeAd,
    specs: parsedSpecs
  });
}

/**
 * POST /api/advertisements
 */
export async function handleCreateAdvertisement(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    if (!data.title || !data.poster_url) {
      return jsonResponse({ error: 'Title and Poster URL are required.' }, 400);
    }

    const id = data.id || `ad_${generateRandomHex(8)}`;
    const pageId = data.display_page_id ? parseInt(data.display_page_id) : 1;
    const priority = data.priority ? parseInt(data.priority) : 1;
    const status = data.status || 'draft';

    await env.DB.prepare(`
      INSERT INTO advertisements (
        id, title, product_id, category_id, poster_url, short_desc, 
        short_desc_ml, detailed_desc, detailed_desc_ml, price, features, 
        promo_info, priority, status, display_page_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      data.title,
      data.product_id || null,
      data.category_id || null,
      data.poster_url,
      data.short_desc || '',
      data.short_desc_ml || '',
      data.detailed_desc || '',
      data.detailed_desc_ml || '',
      data.price !== undefined ? parseFloat(data.price) : null,
      data.features || '',
      data.promo_info || '',
      priority,
      status,
      pageId
    ).run();

    // If schedule dates provided, create schedule record
    if (data.start_time && data.end_time) {
      const scheduleId = `sch_${generateRandomHex(8)}`;
      await env.DB.prepare(`
        INSERT INTO advertisement_schedules (id, advertisement_id, start_time, end_time, duration_sec, priority, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).bind(scheduleId, id, data.start_time, data.end_time, data.duration_sec || 30, priority).run();
    }

    await env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
      generateRandomHex(16),
      `admin:${admin.email}`,
      'AD_CREATED',
      `Advertisement created: ${data.title} (ID: ${id})`
    ).run();

    return jsonResponse({ success: true, message: 'Advertisement created successfully', id }, 201);
  } catch (err) {
    return jsonResponse({ error: 'Failed to create advertisement: ' + err.message }, 500);
  }
}

/**
 * PUT /api/advertisements/:id
 */
export async function handleUpdateAdvertisement(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    const existing = await env.DB.prepare('SELECT id FROM advertisements WHERE id = ?').bind(id).first();
    if (!existing) return jsonResponse({ error: 'Advertisement not found' }, 404);

    await env.DB.prepare(`
      UPDATE advertisements SET
        title = ?, product_id = ?, category_id = ?, poster_url = ?, short_desc = ?, 
        short_desc_ml = ?, detailed_desc = ?, detailed_desc_ml = ?, price = ?, 
        features = ?, promo_info = ?, priority = ?, status = ?, display_page_id = ?, 
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      data.title,
      data.product_id || null,
      data.category_id || null,
      data.poster_url,
      data.short_desc || '',
      data.short_desc_ml || '',
      data.detailed_desc || '',
      data.detailed_desc_ml || '',
      data.price !== undefined ? parseFloat(data.price) : null,
      data.features || '',
      data.promo_info || '',
      data.priority !== undefined ? parseInt(data.priority) : 1,
      data.status || 'draft',
      data.display_page_id !== undefined ? parseInt(data.display_page_id) : 1,
      id
    ).run();

    return jsonResponse({ success: true, message: 'Advertisement updated successfully' });
  } catch (err) {
    return jsonResponse({ error: 'Failed to update advertisement: ' + err.message }, 500);
  }
}

/**
 * DELETE /api/advertisements/:id
 */
export async function handleDeleteAdvertisement(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  await env.DB.prepare('DELETE FROM advertisements WHERE id = ?').bind(id).run();
  await env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
    generateRandomHex(16),
    `admin:${admin.email}`,
    'AD_DELETED',
    `Advertisement deleted: ${id}`
  ).run();

  return jsonResponse({ success: true, message: 'Advertisement deleted successfully' });
}

/**
 * POST /api/advertisements/:id/play-now (Manual Override)
 */
export async function handlePlayNow(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const ad = await env.DB.prepare('SELECT id, title, display_page_id FROM advertisements WHERE id = ?').bind(id).first();
  if (!ad) return jsonResponse({ error: 'Advertisement not found' }, 404);

  // Get current active ad to record in history
  const currentActive = await env.DB.prepare("SELECT id FROM advertisements WHERE status = 'active'").first();

  // Set all other active ads to scheduled/paused and this ad to active
  await env.DB.batch([
    env.DB.prepare("UPDATE advertisements SET status = 'scheduled' WHERE status = 'active'"),
    env.DB.prepare("UPDATE advertisements SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id),
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('active_ad_id', ?)").bind(id),
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('active_ad_page_id', ?)").bind(String(ad.display_page_id || 1)),
    env.DB.prepare("INSERT INTO advertisement_history (id, advertisement_id, activation_time, previous_ad_id, trigger_type, details) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'PLAY_NOW', ?)")
      .bind(generateRandomHex(16), id, currentActive?.id || null, `Manual Play Now triggered by ${admin.email}`),
    env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)")
      .bind(generateRandomHex(16), `admin:${admin.email}`, 'AD_PLAY_NOW', `Manual override activated for: ${ad.title}`)
  ]);

  // Queue a SYNC_AD command for the ESP32 Main Controller
  const commandId = `cmd_${generateRandomHex(8)}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString(); // 60s TTL
  await env.DB.prepare(`
    INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
    VALUES (?, 'ESP32_MAIN_ROBOT_01', 'SYNC_AD', ?, 'PENDING', ?)
  `).bind(commandId, JSON.stringify({ adId: id, pageId: ad.display_page_id || 1 }), expiresAt).run();

  return jsonResponse({
    success: true,
    message: `Advertisement "${ad.title}" is now broadcasting live on Kiosk and DWIN HMI.`,
    activeAdId: id,
    displayPageId: ad.display_page_id || 1
  });
}

/**
 * POST /api/advertisements/:id/pause
 */
export async function handlePauseAdvertisement(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  await env.DB.prepare("UPDATE advertisements SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, message: 'Advertisement paused.' });
}

/**
 * POST /api/advertisements/:id/resume
 */
export async function handleResumeAdvertisement(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  await env.DB.prepare("UPDATE advertisements SET status = 'scheduled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, message: 'Advertisement resumed and scheduled.' });
}

/**
 * GET /api/advertisements/history
 */
export async function handleAdvertisementHistory(request, env) {
  const history = await env.DB.prepare(`
    SELECT h.*, a.title as ad_title, a.poster_url 
    FROM advertisement_history h 
    LEFT JOIN advertisements a ON h.advertisement_id = a.id 
    ORDER BY h.activation_time DESC LIMIT 50
  `).all();

  return jsonResponse({ history: history.results || [] });
}
