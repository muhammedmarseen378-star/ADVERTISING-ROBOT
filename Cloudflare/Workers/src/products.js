// ============================================================================
// Cloudflare Workers Product & Category Management Module
// Handles Product CRUD, Categories, Technical Specifications, and D1 Storage
// ============================================================================

import { authenticateAdmin, jsonResponse } from './auth.js';
import { generateRandomHex } from './crypto.js';

const DEFAULT_CATEGORIES = [
  { id: 'cat_01', name: 'Food & Beverage', slug: 'food-beverage', display_order: 1 },
  { id: 'cat_02', name: 'Education & Training', slug: 'education-training', display_order: 2 },
  { id: 'cat_03', name: 'Computer / Laptop', slug: 'computer-laptop', display_order: 3 },
  { id: 'cat_04', name: 'Mobile / Smartphone', slug: 'mobile-smartphone', display_order: 4 },
  { id: 'cat_05', name: 'Electronics', slug: 'electronics', display_order: 5 },
  { id: 'cat_06', name: 'Automobile & EV', slug: 'automobile-ev', display_order: 6 },
  { id: 'cat_07', name: 'Hotel / Resort', slug: 'hotel-resort', display_order: 7 },
  { id: 'cat_08', name: 'Restaurant / Cafe', slug: 'restaurant-cafe', display_order: 8 },
  { id: 'cat_09', name: 'Clothing / Fashion', slug: 'clothing-fashion', display_order: 9 },
  { id: 'cat_10', name: 'Home Appliances', slug: 'home-appliances', display_order: 10 },
  { id: 'cat_11', name: 'Healthcare / Pharmacy', slug: 'healthcare-pharmacy', display_order: 11 },
  { id: 'cat_12', name: 'Fitness / Gym', slug: 'fitness-gym', display_order: 12 },
  { id: 'cat_13', name: 'Salon / Beauty', slug: 'salon-beauty', display_order: 13 },
  { id: 'cat_14', name: 'Retail / Shopping', slug: 'retail-shopping', display_order: 14 },
  { id: 'cat_15', name: 'Finance / Banking', slug: 'finance-banking', display_order: 15 },
  { id: 'cat_16', name: 'Travel / Tourism', slug: 'travel-tourism', display_order: 16 },
  { id: 'cat_17', name: 'Real Estate', slug: 'real-estate', display_order: 17 },
  { id: 'cat_18', name: 'Service / Repair', slug: 'service-repair', display_order: 18 },
  { id: 'cat_19', name: 'Coaching / Workshops', slug: 'coaching-workshops', display_order: 19 },
  { id: 'cat_20', name: 'Gaming / Esports', slug: 'gaming-esports', display_order: 20 },
  { id: 'cat_21', name: 'Other / Custom', slug: 'other-custom', display_order: 21 }
];

const DEFAULT_PRODUCTS = [];

/**
 * GET /api/categories
 */
export async function handleListCategories(request, env) {
  try {
    if (env.DB) {
      const categories = await env.DB.prepare('SELECT * FROM categories ORDER BY display_order ASC, name ASC').all();
      if (categories && categories.results && categories.results.length > 0) {
        return jsonResponse({ categories: categories.results });
      }
    }
  } catch (err) {
    // DB not yet populated
  }
  return jsonResponse({ categories: DEFAULT_CATEGORIES });
}

/**
 * GET /api/products
 * Query parameters: search, category, limit, offset
 */
export async function handleListProducts(request, env) {
  try {
    if (env.DB) {
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
      return jsonResponse({ products: (result && result.results) ? result.results : [] });
    }
  } catch (err) {
    // DB not yet populated
  }
  return jsonResponse({ products: [] });
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
