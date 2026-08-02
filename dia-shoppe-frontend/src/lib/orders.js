import { supabase } from './supabase'
import { getFirstTouch } from './attribution'

/*
  Real order persistence — replaces the localStorage mock in data/orders.js.
  All calls run as the logged-in user; RLS guarantees users only ever see
  their own orders (admins see all).
*/

export const PAYMENT_LABELS = {
  cod: 'Cash on Delivery',
  online: 'Paid Online (Razorpay)',
  // legacy values from before the checkout offered a single "Pay Online" choice
  upi: 'UPI',
  card: 'Credit / Debit Card',
  netbanking: 'Net Banking',
}

// DB row (+ joined order_items) → the shape the order pages render
const mapOrder = (row) => {
  const items = (row.order_items || []).map((oi) => ({
    id: oi.product_id,
    name: oi.products?.name || `Product #${oi.product_id}`,
    slug: oi.products?.slug,
    qty: oi.quantity,
    price: Number(oi.price_at_purchase),
  }))
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
  const total = Number(row.total_amount)
  return {
    id: row.id,
    date: row.created_at,
    status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
    statusRaw: row.status,
    paymentMethod: row.payment_method,
    payment: PAYMENT_LABELS[row.payment_method] || row.payment_method,
    courier: row.courier,
    trackingNumber: row.tracking_number,
    cancellationReason: row.cancellation_reason,
    cancelledBy: row.cancelled_by,
    refundStatus: row.refund_status,
    refundId: row.refund_id,
    refundAmount: row.refund_amount != null ? Number(row.refund_amount) : null,
    refundError: row.refund_error,
    items,
    customer: {
      name: row.shipping_name,
      phone: row.shipping_phone,
      address: row.shipping_address,
      city: row.shipping_city,
      state: row.shipping_state,
      pincode: row.shipping_pincode,
    },
    totals: { subtotal, savings: 0, shipping: Math.max(0, total - subtotal), total },
  }
}

const ORDER_SELECT = '*, order_items(product_id, quantity, price_at_purchase, products(name, slug))'

/** Creates the order + its line items. Returns { order } or { error }. */
export async function createOrder({
  userId, items, form, paymentMethod, total,
  whatsappOptIn = true, marketingOptIn = false,
}) {
  const address = form.landmark ? `${form.address}, ${form.landmark}` : form.address
  const src = getFirstTouch()

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      user_id: userId,
      total_amount: total,
      status: paymentMethod === 'cod' ? 'confirmed' : 'pending',
      payment_method: paymentMethod,
      shipping_name: form.name,
      shipping_phone: form.phone,
      shipping_address: address,
      shipping_city: form.city,
      shipping_state: form.state,
      shipping_pincode: form.pincode,
      whatsapp_opt_in: whatsappOptIn,
      source: src.channel,
      source_detail: src.detail,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  // Persist marketing consent (+ the phone to reach them on) to the profile so
  // it survives across orders and feeds the broadcast audience. Best-effort:
  // a failure here must not block the order. Only ever *grants* consent here —
  // withdrawal is handled separately so a later order can't silently keep it on.
  if (marketingOptIn) {
    await supabase
      .from('user_profiles')
      .update({
        whatsapp_marketing_opt_in: true,
        marketing_opt_in_at: new Date().toISOString(),
        phone: form.phone,
      })
      .eq('id', userId)
  }

  const lineItems = items.map((i) => ({
    order_id: order.id,
    product_id: i.id,
    quantity: i.qty,
    price_at_purchase: i.price,
  }))
  const { error: itemsError } = await supabase.from('order_items').insert(lineItems)
  if (itemsError) return { error: itemsError.message }

  return { order }
}

/** The logged-in user's orders, newest first (RLS scopes to own rows). */
export async function fetchMyOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message, orders: [] }
  return { orders: data.map(mapOrder) }
}

/** One order by id — null if it doesn't exist or isn't the caller's. */
export async function fetchOrder(id) {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) return { error: error.message, order: null }
  return { order: data ? mapOrder(data) : null }
}

/* ── Admin ─────────────────────────────────────────
   RLS handles authorization: for admins fetchMyOrders() already returns ALL
   orders (the admin SELECT policy), and the UPDATE below only succeeds for
   admins. Non-admins calling these get their own rows / an RLS error. */

// Fulfilment flow: pending → paid → confirmed → shipped → delivered
// (cancelled allowed from pending/paid)
export const ORDER_STATUSES = ['pending', 'paid', 'confirmed', 'shipped', 'delivered', 'cancelled']

export async function updateOrderStatus(id, status, shipping = {}) {
  const patch = { status }
  if (shipping.courier !== undefined) patch.courier = shipping.courier || null
  if (shipping.trackingNumber !== undefined) patch.tracking_number = shipping.trackingNumber || null
  if (status === 'cancelled') {
    patch.cancelled_at = new Date().toISOString()
    patch.cancelled_by = 'admin'
    if (shipping.reason) patch.cancellation_reason = shipping.reason
  }
  const { error } = await supabase.from('orders').update(patch).eq('id', id)
  return { error: error?.message || null }
}

/* ── Customer cancellation ─────────────────────────
   Allowed only before the parcel ships; RLS enforces the same rule so this
   can't be bypassed from the client. The DB trigger puts the stock back. */

export const CANCELLABLE_STATUSES = ['pending', 'paid', 'confirmed']

export const CANCEL_REASONS = [
  'Ordered by mistake',
  'Found it cheaper elsewhere',
  'Delivery is taking too long',
  'Ordered the wrong item',
  'No longer need it',
  'Other',
]

export const canCancel = (statusRaw) => CANCELLABLE_STATUSES.includes(statusRaw)

export async function cancelMyOrder(id, reason) {
  const { error } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      cancellation_reason: reason || null,
      cancelled_at: new Date().toISOString(),
      cancelled_by: 'customer',
    })
    .eq('id', id)
  return { error: error?.message || null }
}

/** Live changes to ONE order (customer tracking page). Returns unsubscribe fn. */
export function onOrderChange(orderId, callback) {
  const channel = supabase
    .channel(`order-${orderId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
      callback
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/** Subscribes to live order changes (insert/update). Returns an unsubscribe fn. */
export function onOrdersChange(callback) {
  const channel = supabase
    .channel('admin-orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, callback)
    .subscribe()
  return () => supabase.removeChannel(channel)
}
