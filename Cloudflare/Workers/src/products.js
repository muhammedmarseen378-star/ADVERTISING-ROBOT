// ============================================================================
// Cloudflare Workers Product & Category Management Module
// Handles Product CRUD, Categories, Technical Specifications, and D1 Storage
// ============================================================================

import { authenticateAdmin, jsonResponse } from './auth.js';
import { generateRandomHex } from './crypto.js';

/**
 * GET /api/categories
 */
export async function handleListCategories(request, env) {
  const categories = await env.DB.prepare('SELECT * FROM categories ORDER BY display_order ASC, name ASC').all();
  return jsonResponse({ categories: categories.results || [] });
}

/**
 * GET /api/products
 * Query parameters: search, category, limit, offset
 */
export async function handleListProducts(request, env) {
  const url = new URL(request.url);
  const search = url.searchParams.get('search') || '';
  const categoryId = url.searchParams.get('category') || '';
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = `
    SELECT p.*, c.name as category_name 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ` AND (p.name LIKE ? OR p.brand LIKE ? OR p.description LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  if (categoryId) {
    query += ` AND p.category_id = ?`;
    params.push(categoryId);
  }

  query += ` ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = env.DB.prepare(query);
  const result = await stmt.bind(...params).all();

  return jsonResponse({ products: result.results || [] });
}

/**
 * GET /api/products/:id
 */
export async function handleGetProduct(request, env, id) {
  const product = await env.DB.prepare(`
    SELECT p.*, c.name as category_name 
    FROM products p 
    LEFT JOIN categories c ON p.category_id = c.id 
    WHERE p.id = ?
  `).bind(id).first();

  if (!product) return jsonResponse({ error: 'Product not found' }, 404);
  return jsonResponse({ product });
}

/**
 * POST /api/products
 */
export async function handleCreateProduct(request, env) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    if (!data.name || !data.category_id) {
      return jsonResponse({ error: 'Product name and category are required.' }, 400);
    }

    const id = data.id || `prod_${generateRandomHex(8)}`;
    const featuresJson = typeof data.features === 'object' ? JSON.stringify(data.features) : (data.features_json || '[]');
    const specsJson = typeof data.specs === 'object' ? JSON.stringify(data.specs) : (data.specs_json || '{}');
    const faqJson = typeof data.faqs === 'object' ? JSON.stringify(data.faqs) : (data.faq_json || '[]');

    await env.DB.prepare(`
      INSERT INTO products (
        id, name, category_id, brand, model, price, currency, description, 
        description_ml, features_json, specs_json, promo_info, availability, 
        faq_json, image_url, notes, is_verified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      data.name,
      data.category_id,
      data.brand || null,
      data.model || null,
      data.price !== undefined ? parseFloat(data.price) : null,
      data.currency || 'INR',
      data.description || '',
      data.description_ml || '',
      featuresJson,
      specsJson,
      data.promo_info || '',
      data.availability || 'In Stock',
      faqJson,
      data.image_url || null,
      data.notes || '',
      data.is_verified ? 1 : 0
    ).run();

    await env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
      generateRandomHex(16),
      `admin:${admin.email}`,
      'PRODUCT_CREATED',
      `Product created: ${data.name} (ID: ${id})`
    ).run();

    return jsonResponse({ success: true, message: 'Product created successfully', id }, 201);
  } catch (err) {
    return jsonResponse({ error: 'Failed to create product: ' + err.message }, 500);
  }
}

/**
 * PUT /api/products/:id
 */
export async function handleUpdateProduct(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const data = await request.json();
    const existing = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
    if (!existing) return jsonResponse({ error: 'Product not found' }, 404);

    const featuresJson = typeof data.features === 'object' ? JSON.stringify(data.features) : (data.features_json || '[]');
    const specsJson = typeof data.specs === 'object' ? JSON.stringify(data.specs) : (data.specs_json || '{}');
    const faqJson = typeof data.faqs === 'object' ? JSON.stringify(data.faqs) : (data.faq_json || '[]');

    await env.DB.prepare(`
      UPDATE products SET
        name = ?, category_id = ?, brand = ?, model = ?, price = ?, 
        currency = ?, description = ?, description_ml = ?, features_json = ?, 
        specs_json = ?, promo_info = ?, availability = ?, faq_json = ?, 
        image_url = ?, notes = ?, is_verified = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      data.name,
      data.category_id,
      data.brand || null,
      data.model || null,
      data.price !== undefined ? parseFloat(data.price) : null,
      data.currency || 'INR',
      data.description || '',
      data.description_ml || '',
      featuresJson,
      specsJson,
      data.promo_info || '',
      data.availability || 'In Stock',
      faqJson,
      data.image_url || null,
      data.notes || '',
      data.is_verified ? 1 : 0,
      id
    ).run();

    return jsonResponse({ success: true, message: 'Product updated successfully' });
  } catch (err) {
    return jsonResponse({ error: 'Failed to update product: ' + err.message }, 500);
  }
}

/**
 * DELETE /api/products/:id
 */
export async function handleDeleteProduct(request, env, id) {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Check if product is referenced in advertisements
  const adCount = await env.DB.prepare('SELECT COUNT(*) as count FROM advertisements WHERE product_id = ?').bind(id).first();
  if (adCount && adCount.count > 0) {
    return jsonResponse({
      error: `Cannot delete product. It is linked to ${adCount.count} advertisement(s). Please unlink or remove the advertisements first.`,
      linkedAdsCount: adCount.count
    }, 409);
  }

  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  await env.DB.prepare("INSERT INTO activity_logs (id, actor, action, details) VALUES (?, ?, ?, ?)").bind(
    generateRandomHex(16),
    `admin:${admin.email}`,
    'PRODUCT_DELETED',
    `Product deleted: ${id}`
  ).run();

  return jsonResponse({ success: true, message: 'Product deleted successfully' });
}
