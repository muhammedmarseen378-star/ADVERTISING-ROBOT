// ============================================================================
// Cloudflare Workers Grok AI Integration Module
// Handles xAI REST API calls, Model Selection, Key Management, Product Research & Voice QA
// ============================================================================

import { encryptSecret, decryptSecret, maskApiKey, generateRandomHex } from './crypto.js';
import { authenticateAdmin, jsonResponse } from './auth.js';

const XAI_BASE_URL = 'https://api.x.ai/v1';
const VERIFIED_FALLBACK_MODELS = [
  { id: 'grok-2-1212', name: 'Grok 2 (Stable - 1212)', description: 'Production general-purpose reasoning model', context_length: 131072 },
  { id: 'grok-2-vision-1212', name: 'Grok 2 Vision (Multimodal)', description: 'Supports visual reasoning and product image inspection', context_length: 32768 },
  { id: 'grok-beta', name: 'Grok Beta', description: 'Early access flagship preview', context_length: 131072 }
];

/**
 * Retrieve decrypted active Grok API Key and Active Model from D1 / Worker Secrets
 */
export async function getActiveGrokConfig(env) {
  const secretKey = env.GROK_ENCRYPTION_SECRET || 'MECHATRONICS_GROK_ENCRYPT_2026';
  
  // 1. Check D1 system_settings for admin-configured key
  const keyRow = await env.DB.prepare("SELECT value, is_encrypted FROM system_settings WHERE key = 'grok_api_key'").first();
  const modelRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'grok_active_model'").first();

  let plainApiKey = null;
  if (keyRow && keyRow.value) {
    if (keyRow.is_encrypted) {
      plainApiKey = await decryptSecret(keyRow.value, secretKey);
    } else {
      plainApiKey = keyRow.value;
    }
  }

  // Fallback to Worker environment secret if not set via dashboard D1
  if (!plainApiKey && env.GROK_API_KEY) {
    plainApiKey = env.GROK_API_KEY;
  }

  const activeModel = (modelRow && modelRow.value) ? modelRow.value : (env.DEFAULT_GROK_MODEL || 'grok-2-1212');

  return {
    apiKey: plainApiKey,
    model: activeModel,
    isConfigured: Boolean(plainApiKey && plainApiKey.trim().length > 0)
  };
}

/**
 * Test a Grok API Key and Model against official xAI endpoint
 */
async function testXaiConnection(apiKey, modelId = 'grok-2-1212') {
  if (!apiKey) throw new Error('API key is empty');
  
  const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: 'You are a test ping for a mechatronics AI robot.' },
        { role: 'user', content: 'Ping' }
      ],
      max_tokens: 5,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedMessage = errorBody;
    try {
      const errObj = JSON.parse(errorBody);
      parsedMessage = errObj.error?.message || errObj.message || errorBody;
    } catch {}
    throw new Error(`xAI API returned status ${response.status}: ${parsedMessage}`);
  }

  const data = await response.json();
  return { success: true, modelUsed: data.model || modelId };
}

/**
 * GET /api/ai/grok/config
 */
export async function handleGetGrokConfig(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized. Admin login required.' }, 401);

  const config = await getActiveGrokConfig(env);
  const statusRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'grok_last_tested_at'").first();
  const errorRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'grok_last_error'").first();

  return jsonResponse({
    isConfigured: config.isConfigured,
    maskedKey: config.apiKey ? maskApiKey(config.apiKey) : null,
    activeModel: config.model,
    lastTestedAt: statusRow?.value || null,
    lastError: errorRow?.value || null
  });
}

/**
 * POST /api/ai/grok/config (Save or update key)
 */
export async function handleSaveGrokConfig(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const { apiKey, modelId } = await request.json();
    if (!apiKey || apiKey.trim().length === 0) {
      return jsonResponse({ error: 'Grok API Key cannot be empty.' }, 400);
    }

    const testModel = modelId || 'grok-2-1212';
    
    // 1. Validate the new key before saving it
    try {
      await testXaiConnection(apiKey, testModel);
    } catch (testErr) {
      // Record failed validation without destroying existing working key
      await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_error', ?, 0, 'Last connection error')")
        .bind(testErr.message).run();
      return jsonResponse({ 
        error: `Validation failed: ${testErr.message}. Existing working configuration was preserved.` 
      }, 400);
    }

    // 2. Encrypt the validated key using AES-GCM
    const secretKey = env.GROK_ENCRYPTION_SECRET || 'MECHATRONICS_GROK_ENCRYPT_2026';
    const encryptedKey = await encryptSecret(apiKey.trim(), secretKey);
    const masked = maskApiKey(apiKey.trim());
    const nowIso = new Date().toISOString();

    // 3. Atomically persist in D1
    await env.DB.batch([
      env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_api_key', ?, 1, 'Encrypted xAI Grok API Key')").bind(encryptedKey),
      env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_api_configured', 'true', 0, 'Grok API configuration flag')"),
      env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_api_masked_key', ?, 0, 'Masked key for UI display')").bind(masked),
      env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_tested_at', ?, 0, 'Timestamp of verified connection')").bind(nowIso),
      env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_error', '', 0, 'Cleared on success')"),
      env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
        generateRandomHex(16),
        `admin:${admin.email}`,
        'GROK_CONFIG_UPDATED',
        `Grok API key updated and verified. Masked: ${masked}`
      )
    ]);

    return jsonResponse({
      success: true,
      message: 'Grok API Key validated and securely stored.',
      maskedKey: masked,
      activeModel: testModel,
      verifiedAt: nowIso
    });
  } catch (err) {
    return jsonResponse({ error: 'Failed to save Grok configuration: ' + err.message }, 500);
  }
}

/**
 * POST /api/ai/grok/test (Test current active configuration)
 */
export async function handleTestGrokConnection(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const config = await getActiveGrokConfig(env);
  if (!config.apiKey) {
    return jsonResponse({ error: 'No Grok API key is configured. Please enter and save an API key first.' }, 400);
  }

  try {
    const startTime = Date.now();
    const result = await testXaiConnection(config.apiKey, config.model);
    const latency = Date.now() - startTime;
    const nowIso = new Date().toISOString();

    await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_tested_at', ?, 0, 'Last test timestamp')")
      .bind(nowIso).run();

    await env.DB.prepare("INSERT INTO ai_logs (id, model_used, request_type, status, duration_ms) VALUES (?, ?, ?, ?, ?)")
      .bind(generateRandomHex(16), config.model, 'TEST', 'SUCCESS', latency).run();

    return jsonResponse({
      success: true,
      message: `Successfully connected to xAI API using ${config.model}`,
      latencyMs: latency,
      testedAt: nowIso
    });
  } catch (err) {
    await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_last_error', ?, 0, 'Last error')")
      .bind(err.message).run();
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * GET /api/ai/grok/models (List supported/available models)
 */
export async function handleListGrokModels(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const config = await getActiveGrokConfig(env);
  
  if (config.apiKey) {
    try {
      const response = await fetch(`${XAI_BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${config.apiKey.trim()}` }
      });
      if (response.ok) {
        const body = await response.json();
        if (Array.isArray(body.data) && body.data.length > 0) {
          const models = body.data.map(m => ({
            id: m.id,
            name: m.id.replace(/-/g, ' ').toUpperCase(),
            description: `Official xAI model (${m.id})`,
            context_length: m.context_window || 131072
          }));
          return jsonResponse({ models, activeModel: config.model, source: 'xai_live_api' });
        }
      }
    } catch (e) {
      console.warn('Could not query live xAI models list, using verified fallback list:', e.message);
    }
  }

  return jsonResponse({ models: VERIFIED_FALLBACK_MODELS, activeModel: config.model, source: 'verified_catalog' });
}

/**
 * POST /api/ai/grok/select-model
 */
export async function handleSelectGrokModel(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const { modelId } = await request.json();
    if (!modelId) return jsonResponse({ error: 'Model ID is required' }, 400);

    const config = await getActiveGrokConfig(env);
    if (config.apiKey) {
      // Validate model works before activating
      await testXaiConnection(config.apiKey, modelId);
    }

    await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value, is_encrypted, description) VALUES ('grok_active_model', ?, 0, 'Active Grok model')")
      .bind(modelId).run();

    await env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
      generateRandomHex(16),
      `admin:${admin.email}`,
      'GROK_MODEL_CHANGED',
      `Active Grok model set to ${modelId}`
    ).run();

    return jsonResponse({ success: true, message: `Model ${modelId} activated successfully.`, activeModel: modelId });
  } catch (err) {
    return jsonResponse({ error: 'Failed to activate model: ' + err.message }, 400);
  }
}

/**
 * POST /api/products/ai-research (Grok AI Product Research)
 */
export async function handleAiProductResearch(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { productName, brand, categoryName, modelNumber } = await request.json();
  if (!productName) return jsonResponse({ error: 'Product name is required for AI research.' }, 400);

  const config = await getActiveGrokConfig(env);
  if (!config.apiKey) {
    return jsonResponse({ error: 'Grok API Key is not configured. Please configure it in Settings.' }, 400);
  }

  const prompt = `You are an expert product analyst and copywriter for an autonomous mechatronic advertisement robot.
Generate verified, realistic product details for:
Product Name: "${productName}"
Brand: "${brand || 'Unknown'}"
Category: "${categoryName || 'General'}"
Model: "${modelNumber || 'Standard'}"

STRICT RULES:
1. Never invent fake government certifications or impossible specs.
2. If exact price is not verified, return 0 for price.
3. Provide a clear, compelling English description (under 250 words).
4. Provide an accurate Malayalam translation (മലയാളം വിവരണം) suitable for South Indian customers.
5. Provide 4 concise bullet features.
6. Provide 4-6 key technical specifications (key-value pairs).
7. Provide 2 common customer FAQs with helpful answers.

Format your response STRICTLY as valid JSON with no markdown backticks, adhering to this structure:
{
  "description": "...",
  "description_ml": "...",
  "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4"],
  "specs": {"Specification 1": "Value 1", "Specification 2": "Value 2"},
  "faqs": [{"q": "Question 1", "a": "Answer 1"}, {"q": "Question 2", "a": "Answer 2"}],
  "suggested_promo": "...",
  "is_verified": false
}`;

  try {
    const startTime = Date.now();
    const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are an AI research assistant. Respond strictly in valid JSON format without markdown code fences.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1200
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`xAI error: ${err}`);
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '{}';
    const cleanedJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanedJson);

    const duration = Date.now() - startTime;
    await env.DB.prepare("INSERT INTO ai_logs (id, model_used, request_type, status, duration_ms) VALUES (?, ?, ?, ?, ?)")
      .bind(generateRandomHex(16), config.model, 'PRODUCT_RESEARCH', 'SUCCESS', duration).run();

    return jsonResponse({ success: true, data: parsed, modelUsed: config.model });
  } catch (err) {
    return jsonResponse({ error: 'AI Research failed: ' + err.message }, 500);
  }
}

/**
 * POST /api/ai/voice/ask (Customer Voice Q&A via Grok)
 */
export async function handleCustomerVoiceQuestion(request, env) {
  const { question, language, activeAdId } = await request.json();
  if (!question || question.trim().length === 0) {
    return jsonResponse({ error: 'Question text is required.' }, 400);
  }

  const config = await getActiveGrokConfig(env);
  if (!config.apiKey) {
    return jsonResponse({ 
      answer: "I am sorry, the AI connection is currently offline. Please contact the administrator.",
      language: language || 'en-IN'
    });
  }

  // Retrieve currently active advertisement and associated product context from D1
  let productContext = "General college advertisement robot.";
  try {
    const activeAd = await env.DB.prepare(`
      SELECT a.title, a.short_desc, a.detailed_desc, a.price, a.features, a.promo_info, 
             p.name as product_name, p.specs_json, p.faq_json, p.availability
      FROM advertisements a
      LEFT JOIN products p ON a.product_id = p.id
      WHERE a.status = 'active' OR a.id = ?
      LIMIT 1
    `).bind(activeAdId || '').first();

    if (activeAd) {
      productContext = `Currently Displayed Advertisement: "${activeAd.title}".
Product: "${activeAd.product_name || activeAd.title}".
Price: ₹${activeAd.price || 'Contact for price'}.
Availability: ${activeAd.availability || 'Inquire'}.
Features: ${activeAd.features || activeAd.short_desc}.
Promotions: ${activeAd.promo_info || 'None currently active'}.
Details: ${activeAd.detailed_desc || ''}.`;
    }
  } catch (e) {
    console.error('Error fetching context:', e);
  }

  const userLang = language || 'en-IN';
  const isMalayalam = userLang.startsWith('ml') || /[\u0D00-\u0D7F]/.test(question);

  const systemPrompt = `You are the AI Voice Assistant for an autonomous Smart Advertisement Robot.
Context about the product currently on display:
${productContext}

RULES:
1. Speak in a friendly, concise, natural tone suitable for robot text-to-speech.
2. Keep answers within 1 to 3 sentences (under 50 words) so audio playback is snappy.
3. NEVER invent prices, discounts, or specifications not mentioned in the context.
4. If asked about price or offers, quote only what is confirmed in the context.
5. If the user speaks Malayalam or asks in Malayalam, answer fluently in Malayalam script. Otherwise answer in English.`;

  try {
    const startTime = Date.now();
    const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0.2,
        max_tokens: 150
      })
    });

    if (!res.ok) {
      throw new Error(`xAI API returned status ${res.status}`);
    }

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content?.trim() || "Thank you for asking. Please visit our booth for more details.";
    const duration = Date.now() - startTime;

    // Log the question in D1
    const qId = generateRandomHex(16);
    await env.DB.prepare(
      "INSERT INTO customer_questions (id, language, recognized_text, ai_response, latency_ms) VALUES (?, ?, ?, ?, ?)"
    ).bind(qId, userLang, question, answer, duration).run();

    return jsonResponse({
      id: qId,
      answer,
      language: isMalayalam ? 'ml-IN' : 'en-IN',
      latencyMs: duration,
      modelUsed: config.model
    });
  } catch (err) {
    return jsonResponse({
      answer: isMalayalam ? "ക്ഷമിക്കണം, എനിക്ക് ഇപ്പോൾ വിവരങ്ങൾ ലഭ്യമാക്കാൻ സാധിക്കുന്നില്ല." : "Sorry, I am unable to fetch that information right now.",
      error: err.message
    }, 500);
  }
}
