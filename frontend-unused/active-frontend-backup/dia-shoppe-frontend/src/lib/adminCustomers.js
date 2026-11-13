import { supabase } from './supabase'

/*
  Registered users + their order history, for the admin Customers page.
  Admin RLS policies (migration 009) grant SELECT on all user_profiles and
  orders; non-admins would only ever see their own rows here.
*/

const SPENT_STATUSES = new Set(['paid', 'confirmed', 'shipped', 'delivered'])

export async function fetchCustomers() {
  const [profilesRes, ordersRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('id, first_name, last_name, email, phone, role, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('user_id, total_amount, status, shipping_city, shipping_state, created_at')
      .order('created_at', { ascending: false }),
  ])

  if (profilesRes.error) return { error: profilesRes.error.message, customers: [] }
  if (ordersRes.error) return { error: ordersRes.error.message, customers: [] }

  // newest-first, so the first order we see per user is their latest
  const byUser = new Map()
  for (const o of ordersRes.data || []) {
    const agg = byUser.get(o.user_id) || { orders: 0, spent: 0, city: null, state: null, lastOrderAt: null }
    if (o.status !== 'cancelled') agg.orders += 1
    if (SPENT_STATUSES.has(o.status)) agg.spent += Number(o.total_amount)
    if (!agg.city && o.shipping_city) { agg.city = o.shipping_city; agg.state = o.shipping_state }
    if (!agg.lastOrderAt) agg.lastOrderAt = o.created_at
    byUser.set(o.user_id, agg)
  }

  const customers = (profilesRes.data || []).map((p) => {
    const agg = byUser.get(p.id) || { orders: 0, spent: 0, city: null, state: null, lastOrderAt: null }
    return {
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || '—',
      email: p.email,
      phone: p.phone,
      role: p.role,
      joined: p.created_at,
      ...agg,
    }
  })

  return { customers }
}
