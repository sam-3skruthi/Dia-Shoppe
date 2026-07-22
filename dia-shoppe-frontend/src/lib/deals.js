/*
  Shared "deals" picking logic — used by the Products-page spotlight and the
  cart-page deals marquee so both always agree on today's picks.
*/
export const discountOf = (p) =>
  p.originalPrice > p.price
    ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)
    : 0

// N deals for today: best-discounted in-stock products, rotating daily so the
// picks change on their own without any admin action.
export function dailyDeals(products, n = 3) {
  const discounted = products
    .filter((p) => discountOf(p) > 0 && p.stock > 0)
    .sort((a, b) => discountOf(b) - discountOf(a))
  if (discounted.length === 0) return []

  const pool = discounted.slice(0, Math.min(9, discounted.length))
  const day = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000)
  const picks = []
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    picks.push(pool[(day * n + i) % pool.length])
  }
  // de-dupe in case the pool is smaller than n
  return [...new Map(picks.map((p) => [p.id, p])).values()]
}
