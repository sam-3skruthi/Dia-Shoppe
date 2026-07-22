import { supabase } from './supabase'

/*
  Dashboard stats computed from real tables (orders, order_items, products,
  user_profiles, feedback). Runs as the logged-in admin — RLS grants the
  admin SELECT policies. Everything is derived client-side from a handful of
  queries; at this store's scale that's a few hundred rows at most.
*/

// Statuses that count as money in (COD 'confirmed' is booked, collected on delivery)
const REVENUE_STATUSES = new Set(['paid', 'confirmed', 'shipped', 'delivered'])

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const LOW_STOCK_AT = 5

export async function fetchDashboardStats() {
  const [ordersRes, productsRes, customersRes, feedbackRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, created_at, status, payment_method, total_amount, shipping_name, order_items(quantity, price_at_purchase, products(name, brand))')
      .order('created_at', { ascending: false }),
    supabase
      .from('products')
      .select('id, name, brand, stock_qty, is_active, image_url')
      .order('stock_qty'),
    supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase
      .from('feedback')
      .select('rating, comment, created_at, orders(shipping_name)')
      .eq('hidden', false)
      .order('created_at', { ascending: false })
      .limit(4),
  ])

  if (ordersRes.error) return { error: ordersRes.error.message }
  if (productsRes.error) return { error: productsRes.error.message }

  const orders = ordersRes.data || []
  const products = productsRes.data || []

  const now = new Date()
  const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`
  const thisMonth = monthKey(now)

  // ── KPIs ──
  const revenueOrders = orders.filter((o) => REVENUE_STATUSES.has(o.status))
  const totalRevenue = revenueOrders.reduce((s, o) => s + Number(o.total_amount), 0)
  const monthRevenue = revenueOrders
    .filter((o) => monthKey(new Date(o.created_at)) === thisMonth)
    .reduce((s, o) => s + Number(o.total_amount), 0)
  const monthOrders = orders.filter((o) => monthKey(new Date(o.created_at)) === thisMonth).length

  // ── Needs attention ──
  const byStatus = {}
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1

  // ── Revenue by month, last 6 months, split COD vs online ──
  const revenueByMonth = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    const inMonth = revenueOrders.filter((o) => monthKey(new Date(o.created_at)) === key)
    revenueByMonth.push({
      label: MONTHS[d.getMonth()],
      cod: inMonth.filter((o) => o.payment_method === 'cod').reduce((s, o) => s + Number(o.total_amount), 0),
      online: inMonth.filter((o) => o.payment_method !== 'cod').reduce((s, o) => s + Number(o.total_amount), 0),
    })
  }

  // ── Top products by units sold (from revenue orders' line items) ──
  const unitsByProduct = new Map()
  for (const o of revenueOrders) {
    for (const oi of o.order_items || []) {
      const name = oi.products?.name || 'Deleted product'
      const cur = unitsByProduct.get(name) || { name, brand: oi.products?.brand || '', units: 0, revenue: 0 }
      cur.units += oi.quantity
      cur.revenue += oi.quantity * Number(oi.price_at_purchase)
      unitsByProduct.set(name, cur)
    }
  }
  const topProducts = [...unitsByProduct.values()].sort((a, b) => b.units - a.units).slice(0, 5)

  // ── Stock alerts (live products only — hidden ones don't sell) ──
  const lowStock = products.filter((p) => p.is_active && p.stock_qty <= LOW_STOCK_AT)

  // ── Recent orders / feedback ──
  const recentOrders = orders.slice(0, 5).map((o) => ({
    id: o.id,
    date: o.created_at,
    status: o.status,
    customer: o.shipping_name,
    total: Number(o.total_amount),
  }))

  const feedback = (feedbackRes.data || []).map((f) => ({
    rating: f.rating,
    comment: f.comment,
    date: f.created_at,
    name: f.orders?.shipping_name || 'Customer',
  }))

  return {
    stats: {
      totalRevenue,
      monthRevenue,
      totalOrders: orders.length,
      monthOrders,
      customers: customersRes.count ?? 0,
      liveProducts: products.filter((p) => p.is_active).length,
      byStatus,
      revenueByMonth,
      topProducts,
      lowStock,
      recentOrders,
      feedback,
    },
  }
}
