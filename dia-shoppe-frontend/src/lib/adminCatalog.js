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
  return { products: data || [], error: error?.message || null }
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

const withoutKey = (fields, key) => {
  const { [key]: _omit, ...rest } = fields
  return rest
}

export async function createProduct(fields) {
  const { data, error } = await supabase.from('products').insert(fields).select().single()
  if (error && isMissingColumn(error.message, 'specs')) {
    const retry = await supabase.from('products').insert(withoutKey(fields, 'specs')).select().single()
    return { product: retry.data, error: retry.error?.message || null }
  }
  return { product: data, error: error?.message || null }
}

export async function updateProduct(id, fields) {
  const { error } = await supabase.from('products').update(fields).eq('id', id)
  if (error && isMissingColumn(error.message, 'specs')) {
    const retry = await supabase.from('products').update(withoutKey(fields, 'specs')).eq('id', id)
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
