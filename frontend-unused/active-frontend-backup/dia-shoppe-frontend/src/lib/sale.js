import { supabase } from './supabase'

/*
  Public sale lookup — used by CatalogContext to overlay discounted prices
  and by the storefront banner. "Active" = is_active AND now() is inside
  [starts_at, ends_at]; if several qualify (shouldn't normally happen) the
  most recently created one wins.
*/
export async function fetchActiveSale() {
  const nowIso = new Date().toISOString()
  const { data: event, error } = await supabase
    .from('sale_events')
    .select('id, name, banner_text, starts_at, ends_at')
    .eq('is_active', true)
    .lte('starts_at', nowIso)
    .gte('ends_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !event) return { event: null, prices: new Map() }

  const { data: rows } = await supabase
    .from('sale_products')
    .select('product_id, sale_price')
    .eq('sale_event_id', event.id)

  const prices = new Map((rows || []).map((r) => [r.product_id, Number(r.sale_price)]))
  return { event, prices }
}
