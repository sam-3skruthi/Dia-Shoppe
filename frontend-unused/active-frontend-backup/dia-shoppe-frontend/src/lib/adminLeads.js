import { supabase } from './supabase'

/*
  Leads — customers with items sitting in their cart who haven't checked out.
  A successful order clears the cart (localStorage + cart_items), so any row
  left in cart_items is a genuine open cart. We group by customer, value the
  cart, and split into:
    • active    — touched within the last hour (still shopping, leave alone)
    • abandoned — untouched for over an hour (a lead worth a nudge)

  Admin RLS (migration 019) lets admins read all carts; user_profiles join
  gives the name / phone / WhatsApp opt-in so staff can send a reminder.
*/

const ABANDON_AFTER_MS = 60 * 60 * 1000 // 1 hour

export async function fetchLeads() {
  // cart_items.user_id references auth.users (not user_profiles directly), so
  // PostgREST can't embed the profile in one query — fetch both and join here.
  const { data, error } = await supabase
    .from('cart_items')
    .select('user_id, quantity, added_at, products(name, price)')
    .order('added_at', { ascending: false })
  if (error) return { error: error.message, leads: [] }

  const userIds = [...new Set((data || []).map((r) => r.user_id))]
  let profiles = {}
  if (userIds.length) {
    const { data: profs, error: pErr } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, email, phone, whatsapp_marketing_opt_in, source')
      .in('id', userIds)
    if (pErr) return { error: pErr.message, leads: [] }
    profiles = Object.fromEntries((profs || []).map((p) => [p.id, p]))
  }

  const byUser = new Map()
  for (const row of data || []) {
    const p = profiles[row.user_id]
    const cur = byUser.get(row.user_id) || {
      userId: row.user_id,
      name: [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Customer',
      email: p?.email || '',
      phone: p?.phone || '',
      optedIn: !!p?.whatsapp_marketing_opt_in,
      source: p?.source || 'Direct',
      items: 0,
      value: 0,
      lastActive: row.added_at,
      products: [],
    }
    cur.items += row.quantity
    cur.value += row.quantity * Number(row.products?.price || 0)
    cur.products.push({ name: row.products?.name || 'Product', qty: row.quantity })
    if (new Date(row.added_at) > new Date(cur.lastActive)) cur.lastActive = row.added_at
    byUser.set(row.user_id, cur)
  }

  const now = Date.now()
  const leads = [...byUser.values()].map((l) => ({
    ...l,
    status: now - new Date(l.lastActive).getTime() > ABANDON_AFTER_MS ? 'abandoned' : 'active',
  }))
  leads.sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))

  const abandoned = leads.filter((l) => l.status === 'abandoned')

  // which platform is generating the most leads
  const sourceMap = new Map()
  for (const l of leads) sourceMap.set(l.source, (sourceMap.get(l.source) || 0) + 1)
  const bySource = [...sourceMap.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)

  return {
    leads,
    stats: {
      total: leads.length,
      abandoned: abandoned.length,
      active: leads.length - abandoned.length,
      abandonedValue: abandoned.reduce((s, l) => s + l.value, 0),
      reachable: abandoned.filter((l) => l.optedIn && l.phone).length,
      bySource,
    },
    error: null,
  }
}

/**
 * Sends a "you left something in your cart" WhatsApp nudge via the
 * whatsapp-remind Edge Function. Only reaches customers who opted in to
 * marketing messages; the function itself re-checks consent server-side.
 */
export async function sendCartReminder(userId) {
  const { data, error } = await supabase.functions.invoke('whatsapp-remind', {
    body: { user_id: userId },
  })
  if (error) return { error: error.message }
  return { result: data }
}
