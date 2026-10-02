import { supabase } from './supabase'

/*
  Admin product management — used by the AdminProducts page. All writes are
  authorized by RLS ("Only admins can modify products"), so a non-admin
  calling these just gets a database error.
*/

export const slugify = (name) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// short unique-enough SKU when the worker leaves it blank, e.g. DS-M3K9F2
export const autoSku = () => 'DS-' + Date.now().toString(36).toUpperCase().slice(-6)

export async function fetchCategories() {
  const { data, error } = await supabase.from('categories').select('id, slug, name').order('id')
  return { categories: data || [], error: error?.message || null }
}

/** All products including hidden ones (admin RLS policy allows it). */
export async function fetchAdminProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*, categories(slug, name)')
    .order('id')
  if (error) return { products: [], error: error.message }
  // cost_price lives in the admin-only product_costs table (migration 032);
  // products.cost_price is always NULL for everyone.
  const { data: costs } = await supabase.from('product_costs').select('product_id, cost_price')
  const costById = new Map((costs || []).map((c) => [c.product_id, c.cost_price]))
  const products = (data || []).map((p) => ({ ...p, cost_price: costById.get(p.id) ?? null }))
  return { products, error: null }
}

/*
  `specs` (migration 024) may not exist yet on databases that haven't been
  migrated. Postgrest reports that as a schema-cache error naming the column;
  in that case we retry once without it so product saves never hard-fail —
  everything except the spec rows still saves, and specs start persisting by
  themselves once the migration is applied.
*/
const isMissingColumn = (msg, col) =>
  !!msg && msg.includes(col) && /schema cache|does not exist|column/i.test(msg)

// columns added by later migrations — dropped from the payload if the DB
// hasn't been migrated yet, so saving never hard-fails
const MAYBE_MISSING = ['specs', 'images']

const withoutMissing = (fields) => {
  const rest = { ...fields }
  for (const key of MAYBE_MISSING) delete rest[key]
  return rest
}

export async function createProduct(fields) {
  const { data, error } = await supabase.from('products').insert(fields).select().single()
  if (error && MAYBE_MISSING.some((c) => isMissingColumn(error.message, c))) {
    const retry = await supabase.from('products').insert(withoutMissing(fields)).select().single()
    return { product: retry.data, error: retry.error?.message || null }
  }
  return { product: data, error: error?.message || null }
}

export async function updateProduct(id, fields) {
  const { error } = await supabase.from('products').update(fields).eq('id', id)
  if (error && MAYBE_MISSING.some((c) => isMissingColumn(error.message, c))) {
    const retry = await supabase.from('products').update(withoutMissing(fields)).eq('id', id)
    return { error: retry.error?.message || null }
  }
  return { error: error?.message || null }
}

/** Hide/show on the storefront — the safe alternative to deleting. */
export async function setProductActive(id, isActive) {
  return updateProduct(id, { is_active: isActive })
}

/** Uploads to the public product-images bucket; returns the public URL. */
export async function uploadProductImage(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || undefined,
  })
  if (error) return { url: null, error: error.message }
  const { data } = supabase.storage.from('product-images').getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}
