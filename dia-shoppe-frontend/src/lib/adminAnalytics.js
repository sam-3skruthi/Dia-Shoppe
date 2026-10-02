import { supabase } from './supabase'

/*
  Sales analytics computed from orders + line items (database truth — exact).
  Visitor behaviour (traffic, funnels, drop-off) lives in PostHog, which the
  Analytics page links out to; money math never comes from analytics scripts.
*/

const REVENUE_STATUSES = new Set(['paid', 'confirmed', 'shipped', 'delivered'])
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export async function fetchAnalytics() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, user_id, created_at, status, payment_method, total_amount, shipping_city, shipping_state, source, order_items(quantity, price_at_purchase, products(name, brand, cost_price, categories(name)))')
    .order('created_at', { ascending: true })
  if (error) return { error: error.message }

  const orders = data || []
  const sales = orders.filter((o) => REVENUE_STATUSES.has(o.status))
  const now = new Date()

  // ── KPIs ──
  const revenue = sales.reduce((s, o) => s + Number(o.total_amount), 0)
  const unitsSold = sales.reduce((s, o) => s + (o.order_items || []).reduce((u, oi) => u + oi.quantity, 0), 0)
  const aov = sales.length ? Math.round(revenue / sales.length) : 0
  const cancelled = orders.filter((o) => o.status === 'cancelled').length
  const repeatBuyers = (() => {
    const counts = new Map()
    for (const o of sales) counts.set(o.user_id, (counts.get(o.user_id) || 0) + 1)
    return [...counts.values()].filter((n) => n > 1).length
  })()

  // ── Daily revenue, last 30 days ──
  const dayKey = (d) => d.toISOString().slice(0, 10)
  const daily = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    daily.push({ key: dayKey(d), label: `${d.getDate()}/${d.getMonth() + 1}`, revenue: 0 })
  }
  const dailyIndex = new Map(daily.map((d, i) => [d.key, i]))
  for (const o of sales) {
    const idx = dailyIndex.get(o.created_at.slice(0, 10))
    if (idx !== undefined) daily[idx].revenue += Number(o.total_amount)
  }

  // ── Orders per month (placed vs cancelled), last 6 months ──
  const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`
  const monthly = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    const inMonth = orders.filter((o) => monthKey(new Date(o.created_at)) === key)
    monthly.push({
      label: MONTHS[d.getMonth()],
      completed: inMonth.filter((o) => REVENUE_STATUSES.has(o.status)).length,
      cancelled: inMonth.filter((o) => o.status === 'cancelled').length,
    })
  }

  // ── Aggregations over sold line items ──
  // Profit uses each product's current cost_price. cost_price may be null
  // (worker hasn't entered it) — those items add to revenue but are excluded
  // from profit, and we track how much revenue HAS cost data so the profit
  // figure is honest rather than silently understated.
  const products = new Map()
  const brands = new Map()
  const categories = new Map()
  let grossProfit = 0        // profit on items whose cost is known
  let costKnownRevenue = 0   // product revenue of those same items
  for (const o of sales) {
    for (const oi of o.order_items || []) {
      const amount = oi.quantity * Number(oi.price_at_purchase)
      const cost = oi.products?.cost_price
      const hasCost = cost !== null && cost !== undefined
      const itemProfit = hasCost ? oi.quantity * (Number(oi.price_at_purchase) - Number(cost)) : 0
      if (hasCost) { grossProfit += itemProfit; costKnownRevenue += amount }

      const pName = oi.products?.name || 'Deleted product'
      const p = products.get(pName) || { name: pName, brand: oi.products?.brand || '', units: 0, revenue: 0, profit: 0, hasCost }
      p.units += oi.quantity; p.revenue += amount; p.profit += itemProfit
      if (hasCost) p.hasCost = true
      products.set(pName, p)

      const bName = oi.products?.brand || 'Unbranded'
      const b = brands.get(bName) || { brand: bName, units: 0, revenue: 0, profit: 0 }
      b.units += oi.quantity; b.revenue += amount; b.profit += itemProfit
      brands.set(bName, b)

      const cName = oi.products?.categories?.name || 'Uncategorised'
      const c = categories.get(cName) || { category: cName, units: 0, revenue: 0, profit: 0 }
      c.units += oi.quantity; c.revenue += amount; c.profit += itemProfit
      categories.set(cName, c)
    }
  }
  const profitMargin = costKnownRevenue > 0 ? Math.round((grossProfit / costKnownRevenue) * 100) : null
  // share of product revenue that has cost data entered (0–1); drives an
  // honesty note in the UI when cost prices are only partially filled in
  const productRevenue = sales.reduce((s, o) =>
    s + (o.order_items || []).reduce((u, oi) => u + oi.quantity * Number(oi.price_at_purchase), 0), 0)
  const costCoverage = productRevenue > 0 ? costKnownRevenue / productRevenue : 0

  // ── Buyers by city (from shipping addresses) ──
  const cities = new Map()
  for (const o of sales) {
    if (!o.shipping_city) continue
    const key = o.shipping_city.trim()
    const c = cities.get(key) || { city: key, state: o.shipping_state, orders: 0, revenue: 0 }
    c.orders += 1; c.revenue += Number(o.total_amount)
    cities.set(key, c)
  }

  // ── Buyer acquisition source (where sales come from) ──
  const sources = new Map()
  for (const o of sales) {
    const key = o.source || 'Direct'
    const s = sources.get(key) || { source: key, orders: 0, revenue: 0 }
    s.orders += 1; s.revenue += Number(o.total_amount)
    sources.set(key, s)
  }

  // ── Payment split ──
  const codOrders = sales.filter((o) => o.payment_method === 'cod').length
  const onlineOrders = sales.length - codOrders

  return {
    stats: {
      revenue, unitsSold, aov, totalOrders: orders.length, completedOrders: sales.length,
      cancelled, repeatBuyers, codOrders, onlineOrders,
      grossProfit, profitMargin, costCoverage,
      daily, monthly,
      topProducts: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
      topBrands: [...brands.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
      byCategory: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
      byCity: [...cities.values()].sort((a, b) => b.orders - a.orders).slice(0, 8),
      bySource: [...sources.values()].sort((a, b) => b.orders - a.orders),
    },
  }
}
