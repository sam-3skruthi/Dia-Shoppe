/*
  Mock admin analytics — stands in for the future backend/analytics API.
  Everything here is deterministic sample data (or derived from the existing
  products/orders mocks) so the dashboard looks real now and can be swapped for
  live data later without changing the UI.

  When the backend exists, replace these exports with API calls returning the
  same shapes:
    - traffic:  GET /analytics/traffic
    - geo:      GET /analytics/locations
    - customers:GET /customers
    - feedback: GET /reviews
    - whatsapp: GET /whatsapp/stats
    - finance:  GET /analytics/sales   (revenue + profit per month)
    - demand:   GET /analytics/demand  (top products / brands)
*/
import { products } from './products'
import { getOrders } from './orders'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// assumed cost = 68% of price → 32% margin (mock, until real cost data exists)
export const costOf = (p) => Math.round(p.price * 0.68)
export const marginOf = (p) => p.price - costOf(p)

/* ── Traffic & conversion (last 12 months) ─────────────── */
const VISITS = [1820, 1960, 2140, 2015, 2480, 2760, 2610, 2905, 3120, 3340, 3180, 3610]
const PURCHASERS = [212, 246, 268, 251, 322, 372, 356, 402, 441, 486, 470, 545]

export const traffic = MONTHS.map((m, i) => ({
  month: m,
  visitors: VISITS[i],
  purchased: PURCHASERS[i],
  notPurchased: VISITS[i] - PURCHASERS[i],
}))

export const trafficTotals = (() => {
  const visitors = VISITS.reduce((a, b) => a + b, 0)
  const purchased = PURCHASERS.reduce((a, b) => a + b, 0)
  const notPurchased = visitors - purchased
  return {
    visitors,
    purchased,
    notPurchased,
    conversion: +((purchased / visitors) * 100).toFixed(1),
    // this month vs last month
    visitorsDelta: +(((VISITS[11] - VISITS[10]) / VISITS[10]) * 100).toFixed(1),
    purchasedDelta: +(((PURCHASERS[11] - PURCHASERS[10]) / PURCHASERS[10]) * 100).toFixed(1),
  }
})()

/* ── Conversion funnel (this month) ────────────────────── */
export const funnel = (() => {
  const arrive = traffic[11].visitors
  const productView = Math.round(arrive * 0.82)
  const addToCart = Math.round(arrive * 0.33)
  const checkout = traffic[11].purchased
  return [
    { stage: 'Arrive Store', value: arrive, delta: trafficTotals.visitorsDelta },
    { stage: 'Product View', value: productView, delta: 8 },
    { stage: 'Add to Cart', value: addToCart, delta: 8 },
    { stage: 'Checkout', value: checkout, delta: trafficTotals.purchasedDelta },
  ]
})()

/* ── Geography — where visitors are ────────────────────── */
export const topLocations = [
  { city: 'Bengaluru', state: 'Karnataka', users: 4820, pct: 27 },
  { city: 'Chennai', state: 'Tamil Nadu', users: 3260, pct: 18 },
  { city: 'Hyderabad', state: 'Telangana', users: 2540, pct: 14 },
  { city: 'Mumbai', state: 'Maharashtra', users: 2110, pct: 12 },
  { city: 'Delhi NCR', state: 'Delhi', users: 1780, pct: 10 },
  { city: 'Other', state: 'Pan-India', users: 3390, pct: 19 },
]

/* ── Customers — who is using it ───────────────────────── */
export const customers = [
  { name: 'Dr. Ramesh Kumar', email: 'ramesh@apollo.in', city: 'Bengaluru', orders: 12, spent: 48200, type: 'Hospital' },
  { name: 'Priya Sharma', email: 'priya.s@gmail.com', city: 'Chennai', orders: 4, spent: 9600, type: 'Individual' },
  { name: 'MediCare Pharmacy', email: 'buy@medicare.in', city: 'Hyderabad', orders: 21, spent: 132400, type: 'Retailer' },
  { name: 'Anil Verma', email: 'anil.v@gmail.com', city: 'Mumbai', orders: 2, spent: 3100, type: 'Individual' },
  { name: 'CityCare Clinic', email: 'admin@citycare.in', city: 'Delhi NCR', orders: 8, spent: 56800, type: 'Clinic' },
]

/* ── Reviews / feedback (storefront feature to be added) ─ */
export const feedback = [
  { name: 'Priya Sharma', product: 'Accu-Chek Instant S Glucometer', rating: 5, comment: 'Delivered in 2 days, 100% original. Very happy!', date: '2026-06-28' },
  { name: 'Dr. Ramesh Kumar', product: 'Omron HEM-7361T BP Monitor', rating: 5, comment: 'Accurate readings, great for our clinic.', date: '2026-06-25' },
  { name: 'Anil Verma', product: 'BPL Smart Pulse Oximeter', rating: 4, comment: 'Good product, packaging could be better.', date: '2026-06-22' },
  { name: 'MediCare Pharmacy', product: 'Littmann Classic III Stethoscope', rating: 5, comment: 'Best bulk pricing and always genuine stock.', date: '2026-06-20' },
  { name: 'Sunita Rao', product: 'Philips DreamStation CPAP', rating: 4, comment: 'Works well, delivery was a day late.', date: '2026-06-18' },
]

export const feedbackAvg = +(
  feedback.reduce((s, f) => s + f.rating, 0) / feedback.length
).toFixed(1)

/* ── WhatsApp automation (needs a provider + opt-in later) ─ */
export const whatsapp = {
  automationOn: true,
  optIns: 2840,          // visitors/customers who shared number + consented
  sent: 5120,
  delivered: 4980,
  read: 4210,
  replies: 612,
  templates: [
    { name: 'Welcome + catalog link', trigger: 'On opt-in', sent: 2840, status: 'Active' },
    { name: 'Cart reminder', trigger: 'Cart abandoned 1h', sent: 1160, status: 'Active' },
    { name: 'Order confirmation', trigger: 'Order placed', sent: 720, status: 'Active' },
    { name: 'Delivery update', trigger: 'Status change', sent: 400, status: 'Active' },
  ],
}

/* ── Finance — revenue & profit per month ──────────────── */
export const finance = MONTHS.map((m, i) => {
  const revenue = PURCHASERS[i] * 1180 + (i % 3) * 4200 // avg order value ~₹1,180
  const profit = Math.round(revenue * 0.31)
  return { month: m, revenue, profit }
})

export const financeTotals = (() => {
  const revenue = finance.reduce((s, f) => s + f.revenue, 0)
  const profit = finance.reduce((s, f) => s + f.profit, 0)
  const last = finance[11].profit
  const prev = finance[10].profit
  return {
    revenue,
    profit,
    thisMonthRevenue: finance[11].revenue,
    thisMonthProfit: last,
    profitDelta: +(((last - prev) / prev) * 100).toFixed(1),
  }
})()

/* ── Demand — top products & brands ────────────────────── */
// deterministic "units sold" from rating + stock so the list is stable
const unitsSold = (p) => p.rating * 140 - p.stock * 3 + (p.id * 7) % 90

export const topProducts = [...products]
  .map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price,
    units: Math.max(20, unitsSold(p)),
    revenue: Math.max(20, unitsSold(p)) * p.price,
    profit: Math.max(20, unitsSold(p)) * marginOf(p),
  }))
  .sort((a, b) => b.units - a.units)

export const topBrands = (() => {
  const map = {}
  topProducts.forEach((p) => {
    map[p.brand] = map[p.brand] || { brand: p.brand, units: 0, revenue: 0 }
    map[p.brand].units += p.units
    map[p.brand].revenue += p.revenue
  })
  return Object.values(map).sort((a, b) => b.units - a.units)
})()

/* ── Insights — rule-based "what to improve" ───────────── */
export function buildInsights() {
  const out = []
  const low = products.filter((p) => p.stock > 0 && p.stock <= 5)
  if (low.length)
    out.push({ tone: 'warn', text: `${low.length} products are low on stock (≤5) — reorder soon: ${low.slice(0, 2).map((p) => p.name).join(', ')}${low.length > 2 ? '…' : ''}.` })

  const out0 = products.filter((p) => p.stock === 0)
  if (out0.length)
    out.push({ tone: 'warn', text: `${out0.length} product(s) are out of stock and losing potential sales.` })

  const topBrand = topBrands[0]
  if (topBrand)
    out.push({ tone: 'good', text: `${topBrand.brand} is your top-selling brand — feature it on the homepage to push volume.` })

  const abandonRate = +((trafficTotals.notPurchased / trafficTotals.visitors) * 100).toFixed(0)
  out.push({ tone: 'info', text: `${abandonRate}% of visitors don't purchase — enable WhatsApp cart reminders & first-order discounts to lift conversion.` })

  const bestMargin = [...topProducts].sort((a, b) => (b.profit / b.units) - (a.profit / a.units))[0]
  if (bestMargin)
    out.push({ tone: 'good', text: `"${bestMargin.name}" has strong margins — promote it in Featured to grow profit.` })

  return out
}
