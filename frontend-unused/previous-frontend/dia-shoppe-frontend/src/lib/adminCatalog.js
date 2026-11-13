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

export async function createProduct(fields) {
  const { data, error } = await supabase.from('products').insert(fields).select().single()
  return { product: data, error: error?.message || null }
}

export async function updateProduct(id, fields) {
  const { error } = await supabase.from('products').update(fields).eq('id', id)
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
