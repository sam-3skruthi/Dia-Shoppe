import { supabase } from './supabase'

/*
  Order reviews. One review per order (feedback.order_id is UNIQUE); RLS only
  accepts inserts for the reviewer's OWN order once its status is 'delivered'
  (migration 011). Reads are public — ratings feed the storefront later.
*/

/** The review for one order, or null if not reviewed yet. */
export async function fetchOrderFeedback(orderId) {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, rating, comment, created_at')
    .eq('order_id', orderId)
    .maybeSingle()
  if (error) return { error: error.message, feedback: null }
  return { feedback: data }
}

export async function submitFeedback({ userId, orderId, rating, comment }) {
  const { data, error } = await supabase
    .from('feedback')
    .insert({ user_id: userId, order_id: orderId, rating, comment: comment.trim() || null })
    .select('id, rating, comment, created_at')
    .single()
  if (error) {
    // unique violation → someone double-submitted; treat as already reviewed
    if (error.code === '23505') return { error: 'This order has already been reviewed.' }
    return { error: error.message }
  }
  return { feedback: data }
}

/** All reviews with reviewer + ordered products (admin Reviews page). */
export async function fetchAllFeedback() {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, rating, comment, created_at, order_id, hidden, orders(shipping_name, order_items(products(name)))')
    .order('created_at', { ascending: false })
  if (error) return { error: error.message, reviews: [] }
  const reviews = (data || []).map((f) => ({
    id: f.id,
    rating: f.rating,
    comment: f.comment,
    date: f.created_at,
    orderId: f.order_id,
    hidden: f.hidden,
    name: f.orders?.shipping_name || 'Customer',
    products: (f.orders?.order_items || []).map((oi) => oi.products?.name).filter(Boolean),
  }))
  return { reviews }
}

/**
 * Admin moderation: hide or un-hide a review. Hidden reviews stay in the DB
 * but disappear from the storefront and public averages (RLS + migration 023).
 */
export async function setFeedbackHidden(id, hidden) {
  const { error } = await supabase.from('feedback').update({ hidden }).eq('id', id)
  return { error: error?.message || null }
}
