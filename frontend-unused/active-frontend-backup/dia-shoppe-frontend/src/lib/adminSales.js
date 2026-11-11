import { supabase } from './supabase'

/*
  Admin sale-event management. A sale is a date-windowed set of per-product
  discounted prices (see migration 015); the storefront applies it on its own
  while the window is open and reverts on its own once ends_at passes.
*/

export async function fetchSaleEvents() {
  const { data, error } = await supabase
    .from('sale_events')
    .select('id, name, banner_text, starts_at, ends_at, is_active, created_at, sale_products(product_id, sale_price, products(name, price))')
    .order('created_at', { ascending: false })
  if (error) return { error: error.message, events: [] }

  const events = (data || []).map((e) => ({
    id: e.id,
    name: e.name,
    bannerText: e.banner_text,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    isActive: e.is_active,
    createdAt: e.created_at,
    products: (e.sale_products || []).map((sp) => ({
      productId: sp.product_id,
      salePrice: Number(sp.sale_price),
      name: sp.products?.name,
      regularPrice: sp.products?.price != null ? Number(sp.products.price) : null,
    })),
  }))
  return { events }
}

/** Creates a sale event + its product prices in one go. */
export async function createSaleEvent({ name, bannerText, startsAt, endsAt, products }) {
  const { data: event, error } = await supabase
    .from('sale_events')
    .insert({ name, banner_text: bannerText || null, starts_at: startsAt, ends_at: endsAt })
    .select()
    .single()
  if (error) return { error: error.message }

  if (products.length > 0) {
    const rows = products.map((p) => ({ sale_event_id: event.id, product_id: p.productId, sale_price: p.salePrice }))
    const { error: prodError } = await supabase.from('sale_products').insert(rows)
    if (prodError) return { error: prodError.message }
  }
  return { event }
}

export async function updateSaleEvent(id, { name, bannerText, startsAt, endsAt, products }) {
  const { error } = await supabase
    .from('sale_events')
    .update({ name, banner_text: bannerText || null, starts_at: startsAt, ends_at: endsAt })
    .eq('id', id)
  if (error) return { error: error.message }

  // full-replace the product list — simplest correct approach for a small set
  await supabase.from('sale_products').delete().eq('sale_event_id', id)
  if (products.length > 0) {
    const rows = products.map((p) => ({ sale_event_id: id, product_id: p.productId, sale_price: p.salePrice }))
    const { error: prodError } = await supabase.from('sale_products').insert(rows)
    if (prodError) return { error: prodError.message }
  }
  return { error: null }
}

/** Ends a sale immediately (sets ends_at to now) rather than deleting history. */
export async function endSaleNow(id) {
  const { error } = await supabase.from('sale_events').update({ ends_at: new Date().toISOString() }).eq('id', id)
  return { error: error?.message || null }
}

export async function deleteSaleEvent(id) {
  const { error } = await supabase.from('sale_events').delete().eq('id', id)
  return { error: error?.message || null }
}
