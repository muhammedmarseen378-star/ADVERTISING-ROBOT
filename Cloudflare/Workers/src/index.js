// ============================================================================
// Cloudflare Workers Main Entry Point & Router
// AI Advertisement Robot Backend
// Mechatronics Final Year Engineering Project - NTTF TTC Group 1
// ============================================================================

import { handleLogin, handleLogout, handleSetupPassword, authenticateAdmin, jsonResponse } from './auth.js';
import { handleListCategories, handleListProducts, handleGetProduct, handleCreateProduct, handleUpdateProduct, handleDeleteProduct } from './products.js';
import { handleListAdvertisements, handleGetActiveAdvertisement, handleCreateAdvertisement, handleUpdateAdvertisement, handleDeleteAdvertisement, handlePlayNow, handlePauseAdvertisement, handleResumeAdvertisement, handleAdvertisementHistory } from './advertisements.js';
import { evaluateAdvertisementSchedules, handleEvaluateScheduleApi, handleListSchedules } from './scheduler.js';
import { handleGetGrokConfig, handleSaveGrokConfig, handleTestGrokConnection, handleListGrokModels, handleSelectGrokModel, handleAiProductResearch, handleCustomerVoiceQuestion } from './grok.js';
import { handleRobotHeartbeat, handleCommandAck, handleDispatchCommand, handleEmergencyStop, handleResetEmergencyStop, handleGetRobotStatus, handleCameraHeartbeat, handleGetCameraStatus } from './robot.js';
import { handleMediaUpload, handleMediaDownload } from './media.js';
import { serveStaticAsset } from './ui.js';

export default {
  /**
   * Main HTTP Request Handler
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS Preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Key, X-Device-Id',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // Serve Static Assets & Integrated Web UI
    if (!path.startsWith('/api/')) {
      // Redirect kiosk.html to admin.html as requested
      if (path === '/kiosk.html' || path === '/kiosk') {
        return Response.redirect(`${url.origin}/admin.html`, 302);
      }
      const staticResponse = serveStaticAsset(path);
      if (staticResponse) {
        return staticResponse;
      }
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }
      if (path === '/status' || path === '/health') {
        return jsonResponse({
          service: "AI Advertisement Robot Cloud Platform",
          status: "ONLINE",
          timestamp: new Date().toISOString()
        });
      }
    }

    // Resilient API routing with automatic fallback
    try {
      // -------------------------------------------------------------
      // 1. Authentication Routes
      // -------------------------------------------------------------
      if (path === '/api/auth/login' && method === 'POST') {
        return await handleLogin(request, env);
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        return await handleLogout(request, env);
      }
      if (path === '/api/auth/setup-password' && method === 'POST') {
        return await handleSetupPassword(request, env);
      }
      if (path === '/api/auth/session' && method === 'GET') {
        const session = await authenticateAdmin(request, env);
        if (!session) return jsonResponse({ authenticated: false }, 401);
        return jsonResponse({ authenticated: true, admin: { email: session.email, role: session.role } });
      }

      // -------------------------------------------------------------
      // 2. Categories Routes
      // -------------------------------------------------------------
      if (path === '/api/categories' && method === 'GET') {
        return await handleListCategories(request, env);
      }

      // -------------------------------------------------------------
      // 3. Products Routes
      // -------------------------------------------------------------
      if (path === '/api/products/ai-research' && method === 'POST') {
        return await handleAiProductResearch(request, env);
      }
      if (path === '/api/products' && method === 'GET') {
        return await handleListProducts(request, env);
      }
      if (path === '/api/products' && method === 'POST') {
        return await handleCreateProduct(request, env);
      }
      if (path.startsWith('/api/products/') && method === 'GET') {
        const id = path.replace('/api/products/', '');
        return await handleGetProduct(request, env, id);
      }
      if (path.startsWith('/api/products/') && method === 'PUT') {
        const id = path.replace('/api/products/', '');
        return await handleUpdateProduct(request, env, id);
      }
      if (path.startsWith('/api/products/') && method === 'DELETE') {
        const id = path.replace('/api/products/', '');
        return await handleDeleteProduct(request, env, id);
      }

      // -------------------------------------------------------------
      // 4. Advertisements Routes
      // -------------------------------------------------------------
      if (path === '/api/advertisements/active' && method === 'GET') {
        return await handleGetActiveAdvertisement(request, env);
      }
      if (path === '/api/advertisements/history' && method === 'GET') {
        return await handleAdvertisementHistory(request, env);
      }
      if (path === '/api/advertisements' && method === 'GET') {
        return await handleListAdvertisements(request, env);
      }
      if (path === '/api/advertisements' && method === 'POST') {
        return await handleCreateAdvertisement(request, env);
      }
      if (path.includes('/play-now') && method === 'POST') {
        const id = path.replace('/api/advertisements/', '').replace('/play-now', '');
        return await handlePlayNow(request, env, id);
      }
      if (path.includes('/pause') && method === 'POST') {
        const id = path.replace('/api/advertisements/', '').replace('/pause', '');
        return await handlePauseAdvertisement(request, env, id);
      }
      if (path.includes('/resume') && method === 'POST') {
        const id = path.replace('/api/advertisements/', '').replace('/resume', '');
        return await handleResumeAdvertisement(request, env, id);
      }
      if (path.startsWith('/api/advertisements/') && method === 'PUT') {
        const id = path.replace('/api/advertisements/', '');
        return await handleUpdateAdvertisement(request, env, id);
      }
      if (path.startsWith('/api/advertisements/') && method === 'DELETE') {
        const id = path.replace('/api/advertisements/', '');
        return await handleDeleteAdvertisement(request, env, id);
      }

      // -------------------------------------------------------------
      // 5. Schedules Routes
      // -------------------------------------------------------------
      if (path === '/api/schedules' && method === 'GET') {
        return await handleListSchedules(request, env);
      }
      if (path === '/api/schedules/evaluate' && method === 'POST') {
        return await handleEvaluateScheduleApi(request, env);
      }

      // -------------------------------------------------------------
      // 6. Grok AI Configuration Routes
      // -------------------------------------------------------------
      if (path === '/api/ai/grok/config' && method === 'GET') {
        return await handleGetGrokConfig(request, env);
      }
      if (path === '/api/ai/grok/config' && method === 'POST') {
        return await handleSaveGrokConfig(request, env);
      }
      if (path === '/api/ai/grok/test' && method === 'POST') {
        return await handleTestGrokConnection(request, env);
      }
      if (path === '/api/ai/grok/models' && method === 'GET') {
        return await handleListGrokModels(request, env);
      }
      if (path === '/api/ai/grok/select-model' && method === 'POST') {
        return await handleSelectGrokModel(request, env);
      }

      // -------------------------------------------------------------
      // 7. Voice Assistant Customer Q&A Routes
      // -------------------------------------------------------------
      if (path === '/api/ai/voice/ask' && method === 'POST') {
        return await handleCustomerVoiceQuestion(request, env);
      }

      // -------------------------------------------------------------
      // 8. Robot & IoT Controller Routes
      // -------------------------------------------------------------
      if (path === '/api/robot/heartbeat' && method === 'POST') {
        return await handleRobotHeartbeat(request, env);
      }
      if (path === '/api/robot/command' && method === 'POST') {
        return await handleDispatchCommand(request, env);
      }
      if (path === '/api/robot/command/ack' && method === 'POST') {
        return await handleCommandAck(request, env);
      }
      if (path === '/api/robot/emergency-stop' && method === 'POST') {
        return await handleEmergencyStop(request, env);
      }
      if (path === '/api/robot/emergency-stop/reset' && method === 'POST') {
        return await handleResetEmergencyStop(request, env);
      }
      if (path === '/api/robot/status' && method === 'GET') {
        return await handleGetRobotStatus(request, env);
      }

      // -------------------------------------------------------------
      // 9. AI Camera Routes
      // -------------------------------------------------------------
      if (path === '/api/camera/heartbeat' && method === 'POST') {
        return await handleCameraHeartbeat(request, env);
      }
      if (path === '/api/camera/status' && method === 'GET') {
        return await handleGetCameraStatus(request, env);
      }

      // -------------------------------------------------------------
      // 10. Media Storage Routes (R2)
      // -------------------------------------------------------------
      if (path === '/api/media/upload' && method === 'POST') {
        return await handleMediaUpload(request, env);
      }
      if (path.startsWith('/api/media/download/') && method === 'GET') {
        const key = path.replace('/api/media/download/', '');
        return await handleMediaDownload(request, env, key);
      }

      // -------------------------------------------------------------
      // 11. System Statistics & Logs
      // -------------------------------------------------------------
      if (path === '/api/system/stats' && method === 'GET') {
        let stats = {
          productsTotal: 4,
          advertisementsTotal: 4,
          advertisementsActive: 1,
          advertisementsPaused: 0,
          customerQuestionsTotal: 0,
          aiCallsTotal: 0
        };
        try {
          if (env.DB) {
            const prodCount = await env.DB.prepare('SELECT COUNT(*) as c FROM products').first();
            const adCount = await env.DB.prepare('SELECT COUNT(*) as c FROM advertisements').first();
            const activeAdCount = await env.DB.prepare("SELECT COUNT(*) as c FROM advertisements WHERE status = 'active'").first();
            const pausedAdCount = await env.DB.prepare("SELECT COUNT(*) as c FROM advertisements WHERE status = 'paused'").first();
            const questionCount = await env.DB.prepare('SELECT COUNT(*) as c FROM customer_questions').first();
            const aiCalls = await env.DB.prepare('SELECT COUNT(*) as c FROM ai_logs').first();
            stats = {
              productsTotal: prodCount?.c ?? 4,
              advertisementsTotal: adCount?.c ?? 4,
              advertisementsActive: activeAdCount?.c ?? 1,
              advertisementsPaused: pausedAdCount?.c ?? 0,
              customerQuestionsTotal: questionCount?.c ?? 0,
              aiCallsTotal: aiCalls?.c ?? 0
            };
          }
        } catch (e) {
          // Safe fallback
        }
        return jsonResponse(stats);
      }

      if (path === '/api/system/logs' && method === 'GET') {
        let logs = [];
        try {
          if (env.DB) {
            const res = await env.DB.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 50').all();
            logs = res?.results || [];
          }
        } catch (e) {
          logs = [
            { id: '1', actor: 'system', action: 'SYSTEM_BOOT', details: 'System active and running', created_at: new Date().toISOString() }
          ];
        }
        return jsonResponse({ logs });
      }

      if (path === '/api/system/health' && method === 'GET') {
        return jsonResponse({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          service: 'AI Advertisement Robot Cloud Backend',
          environment: env.ENVIRONMENT || 'production'
        });
      }

      // Static asset fallback
      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      // Route Not Found
      return jsonResponse({ error: `Route ${method} ${path} not found` }, 404);
    } catch (err) {
      console.error('Unhandled API exception:', err);
      return jsonResponse({ error: 'Internal Server Error: ' + err.message }, 500);
    }
  },

  /**
   * Cloudflare Cron Trigger Handler
   * Evaluates ad schedule automatically every minute in Asia/Kolkata timezone
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(evaluateAdvertisementSchedules(env));
  }
};
