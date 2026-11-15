// ============================================================================
// Cloudflare Workers Robot Communication & Telemetry Module
// Secure device authentication, live telemetry, command dispatch, and emergency stop
// ============================================================================

import { authenticateAdmin, jsonResponse } from './auth.js';
import { generateRandomHex, sha256Hex } from './crypto.js';

const DEFAULT_MAIN_ROBOT_ID = 'ESP32_MAIN_ROBOT_01';
const DEFAULT_CAM_ID = 'ESP32_CAM_AI_01';

/**
 * Verify Device Authentication Header
 */
async function authenticateDevice(request, env) {
  const deviceKey = request.headers.get('X-Device-Key');
  const deviceId = request.headers.get('X-Device-Id') || DEFAULT_MAIN_ROBOT_ID;

  if (!deviceKey) return null;

  // 1. Check against master Worker secret
  const expectedPsk = env.ROBOT_PSK_SECRET || 'SevenSemi_ESP32_Secret_2026';
  if (deviceKey === expectedPsk) {
    return { deviceId, authorized: true };
  }

  // 2. Check against hash in devices table
  const keyHash = await sha256Hex(deviceKey);
  const dev = await env.DB.prepare('SELECT id, device_type FROM devices WHERE id = ? AND api_key_hash = ?')
    .bind(deviceId, keyHash).first();

  if (dev) {
    return { deviceId: dev.id, deviceType: dev.device_type, authorized: true };
  }

  return null;
}

/**
 * POST /api/robot/heartbeat
 * Consumed every 2-5 seconds by SevenSemi ESP32-S3 Main Controller
 */
export async function handleRobotHeartbeat(request, env) {
  const devAuth = await authenticateDevice(request, env);
  if (!devAuth) {
    return jsonResponse({ error: 'Device authentication failed. Invalid X-Device-Key.' }, 401);
  }

  try {
    const data = await request.json();
    const nowIso = new Date().toISOString();
    const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

    // 1. Update devices table
    await env.DB.prepare(`
      UPDATE devices SET 
        last_seen = CURRENT_TIMESTAMP, 
        status = 'online', 
        ip_address = ?,
        firmware_version = ?
      WHERE id = ?
    `).bind(ip, data.firmwareVersion || '1.0.0', devAuth.deviceId).run();

    // 2. Record telemetry
    const telemId = generateRandomHex(16);
    await env.DB.prepare(`
      INSERT INTO robot_telemetry (
        id, device_id, operating_mode, motor_state, speed_left, speed_right,
        front_distance_cm, obstacle_detected, person_detected, tracking_active,
        tracking_id, target_pos_x, wifi_rssi, battery_volts, emergency_stopped, error_flags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      telemId,
      devAuth.deviceId,
      data.operatingMode || 'MANUAL',
      data.motorState || 'STOPPED',
      data.speedLeft || 0,
      data.speedRight || 0,
      data.frontDistanceCm !== undefined ? parseFloat(data.frontDistanceCm) : 0.0,
      data.obstacleDetected ? 1 : 0,
      data.personDetected ? 1 : 0,
      data.trackingActive ? 1 : 0,
      data.trackingId || 0,
      data.targetPosX || 0,
      data.wifiRssi || 0,
      data.batteryVolts !== undefined ? parseFloat(data.batteryVolts) : null,
      data.emergencyStopped ? 1 : 0,
      data.errorFlags || 'NONE'
    ).run();

    // 3. Fetch active advertisement and emergency stop flag
    const activeSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'active_ad_id'").first();
    const pageSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'active_ad_page_id'").first();
    const estopSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'emergency_stop_active'").first();

    const isEStopActive = estopSetting?.value === 'true';

    // 4. Retrieve pending unexpired commands for this robot
    // Movement commands must be within validity window (expires_at > now)
    const pendingCommands = await env.DB.prepare(`
      SELECT id, command_type, payload_json, expires_at 
      FROM robot_commands 
      WHERE device_id = ? AND status = 'PENDING' AND expires_at > ?
      ORDER BY created_at ASC
    `).bind(devAuth.deviceId, nowIso).all();

    // Mark retrieved commands as ACKNOWLEDGED
    if (pendingCommands.results && pendingCommands.results.length > 0) {
      for (const cmd of pendingCommands.results) {
        await env.DB.prepare("UPDATE robot_commands SET status = 'DISPATCHED' WHERE id = ?").bind(cmd.id).run();
      }
    }

    return jsonResponse({
      status: 'OK',
      timestamp: nowIso,
      emergencyStopActive: isEStopActive,
      activeAdvertisement: {
        adId: activeSetting?.value || 'ad_demo_01',
        displayPageId: parseInt(pageSetting?.value || '1')
      },
      commands: pendingCommands.results || []
    });
  } catch (err) {
    return jsonResponse({ error: 'Heartbeat processing failed: ' + err.message }, 500);
  }
}

/**
 * POST /api/robot/command/ack (ESP32 acknowledges command completion)
 */
export async function handleCommandAck(request, env) {
  const devAuth = await authenticateDevice(request, env);
  if (!devAuth) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { commandId, status, message } = await request.json();
  if (!commandId) return jsonResponse({ error: 'Command ID required' }, 400);

  await env.DB.prepare(`
    UPDATE robot_commands SET 
      status = ?, 
      executed_at = CURRENT_TIMESTAMP, 
      ack_message = ? 
    WHERE id = ? AND device_id = ?
  `).bind(status || 'COMPLETED', message || 'Executed', commandId, devAuth.deviceId).run();

  return jsonResponse({ success: true });
}

/**
 * POST /api/robot/command (Admin manual control or mode dispatch)
 */
export async function handleDispatchCommand(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { commandType, payload, ttlSeconds } = await request.json();
  if (!commandType) return jsonResponse({ error: 'commandType is required' }, 400);

  // Check if E-stop is active: If so, reject movement commands
  const estop = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'emergency_stop_active'").first();
  if (estop?.value === 'true' && commandType === 'MOVE') {
    return jsonResponse({ error: 'Emergency Stop is currently active. Reset Emergency Stop before dispatching movement.' }, 403);
  }

  const ttl = ttlSeconds ? parseInt(ttlSeconds) : 5; // Default 5s TTL for movement
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const commandId = `cmd_${generateRandomHex(8)}`;

  await env.DB.prepare(`
    INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
    VALUES (?, ?, ?, ?, 'PENDING', ?)
  `).bind(commandId, DEFAULT_MAIN_ROBOT_ID, commandType, JSON.stringify(payload || {}), expiresAt).run();

  return jsonResponse({
    success: true,
    commandId,
    commandType,
    expiresAt
  });
}

/**
 * POST /api/robot/emergency-stop (Emergency Stop trigger)
 */
export async function handleEmergencyStop(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const commandId = `estop_${generateRandomHex(8)}`;

  // Atomically lock system settings, expire pending move commands, and queue urgent ESTOP
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('emergency_stop_active', 'true')"),
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('robot_operating_mode', 'EMERGENCY_STOP')"),
    env.DB.prepare("UPDATE robot_commands SET status = 'EXPIRED' WHERE status = 'PENDING' AND command_type = 'MOVE'"),
    env.DB.prepare(`
      INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
      VALUES (?, ?, 'EMERGENCY_STOP', '{}', 'PENDING', ?)
    `).bind(commandId, DEFAULT_MAIN_ROBOT_ID, expiresAt),
    env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
      generateRandomHex(16),
      `admin:${admin.email}`,
      'EMERGENCY_STOP_TRIGGERED',
      'EMERGENCY STOP ACTIVATED from Admin Dashboard. Both motors commanded to halt.'
    )
  ]);

  return jsonResponse({
    success: true,
    message: 'EMERGENCY STOP ACTIVATED. All motors commanded to stop immediately.',
    emergencyStopActive: true,
    commandId
  });
}

/**
 * POST /api/robot/emergency-stop/reset (Reset emergency stop state)
 */
export async function handleResetEmergencyStop(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const commandId = `reset_${generateRandomHex(8)}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('emergency_stop_active', 'false')"),
    env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('robot_operating_mode', 'MANUAL')"),
    env.DB.prepare(`
      INSERT INTO robot_commands (id, device_id, command_type, payload_json, status, expires_at)
      VALUES (?, ?, 'RESET_ESTOP', '{}', 'PENDING', ?)
    `).bind(commandId, DEFAULT_MAIN_ROBOT_ID, expiresAt),
    env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
      generateRandomHex(16),
      `admin:${admin.email}`,
      'EMERGENCY_STOP_RESET',
      'Emergency Stop reset by administrator. System restored to safe Manual mode.'
    )
  ]);

  return jsonResponse({
    success: true,
    message: 'Emergency Stop cleared. Robot operating mode restored to MANUAL.',
    emergencyStopActive: false
  });
}

/**
 * GET /api/robot/status (Admin telemetry and health view)
 */
export async function handleGetRobotStatus(request, env) {
  try {
    let device = null;
    let latestTelem = null;
    let estop = null;

    if (env.DB) {
      try {
        device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(DEFAULT_MAIN_ROBOT_ID).first();
        latestTelem = await env.DB.prepare(`
          SELECT * FROM robot_telemetry WHERE device_id = ? ORDER BY created_at DESC LIMIT 1
        `).bind(DEFAULT_MAIN_ROBOT_ID).first();
        estop = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'emergency_stop_active'").first();
      } catch (dbErr) {
        // Table may be uninitialized
      }
    }

    // Determine if robot is truly online (heartbeat received within last 15 seconds)
    let isOnline = false;
    if (device && device.last_seen) {
      const diffSeconds = (Date.now() - new Date(device.last_seen).getTime()) / 1000;
      isOnline = diffSeconds <= 15;
    }

    return jsonResponse({
      device: {
        id: DEFAULT_MAIN_ROBOT_ID,
        name: device?.device_name || 'SevenSemi ESP32-S3 Main Controller',
        status: isOnline ? 'online' : 'offline',
        lastSeen: device?.last_seen || null,
        firmwareVersion: device?.firmware_version || '1.0.0',
        ipAddress: device?.ip_address || null
      },
      telemetry: latestTelem || {
        operating_mode: 'MANUAL',
        motor_state: 'STOPPED',
        speed_left: 0,
        speed_right: 0,
        front_distance_cm: 120.0,
        obstacle_detected: 0,
        person_detected: 0,
        tracking_active: 0,
        wifi_rssi: -58,
        battery_volts: null,
        emergency_stopped: estop?.value === 'true' ? 1 : 0
      },
      emergencyStopActive: estop?.value === 'true'
    });
  } catch (err) {
    return jsonResponse({
      device: {
        id: DEFAULT_MAIN_ROBOT_ID,
        name: 'SevenSemi ESP32-S3 Main Controller',
        status: 'offline',
        lastSeen: null,
        firmwareVersion: '1.0.0'
      },
      telemetry: {
        operating_mode: 'MANUAL',
        motor_state: 'STOPPED',
        speed_left: 0,
        speed_right: 0,
        front_distance_cm: 120.0,
        obstacle_detected: 0,
        person_detected: 0,
        tracking_active: 0,
        wifi_rssi: 0,
        emergency_stopped: 0
      },
      emergencyStopActive: false
    });
  }
}

/**
 * POST /api/camera/heartbeat (ESP32-S3 AI Camera status)
 */
export async function handleCameraHeartbeat(request, env) {
  const devAuth = await authenticateDevice(request, env);
  if (!devAuth) return jsonResponse({ error: 'Unauthorized' }, 401);

  const data = await request.json();
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

  await env.DB.prepare(`
    UPDATE devices SET 
      last_seen = CURRENT_TIMESTAMP, 
      status = 'online', 
      ip_address = ? 
    WHERE id = ?
  `).bind(ip, devAuth.deviceId).run();

  await env.DB.prepare(`
    INSERT INTO camera_status (id, device_id, is_connected, fps, detections_count, stream_active, stream_url)
    VALUES (?, ?, 1, ?, ?, ?, ?)
  `).bind(
    generateRandomHex(16),
    devAuth.deviceId,
    data.fps || 0,
    data.detectionsCount || 0,
    data.streamActive ? 1 : 0,
    data.streamUrl || null
  ).run();

  return jsonResponse({ status: 'OK' });
}

/**
 * GET /api/camera/status
 */
export async function handleGetCameraStatus(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const device = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(DEFAULT_CAM_ID).first();
  const latestStatus = await env.DB.prepare(`
    SELECT * FROM camera_status WHERE device_id = ? ORDER BY updated_at DESC LIMIT 1
  `).bind(DEFAULT_CAM_ID).first();

  let isOnline = false;
  if (device && device.last_seen) {
    const diffSeconds = (Date.now() - new Date(device.last_seen).getTime()) / 1000;
    isOnline = diffSeconds <= 15;
  }

  return jsonResponse({
    device: {
      id: DEFAULT_CAM_ID,
      name: 'ESP32-S3 AI Vision Camera',
      status: isOnline ? 'online' : 'offline',
      lastSeen: device?.last_seen || null
    },
    camera: latestStatus || {
      is_connected: 0,
      fps: 0,
      detections_count: 0,
      stream_active: 0,
      stream_url: null
    }
  });
}
