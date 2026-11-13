import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { StackedBars, AreaChart, BarRow } from '../../components/admin/Charts'
import { fetchAnalytics } from '../../lib/adminAnalytics'
import {
  FiShoppingBag, FiDollarSign, FiTrendingUp, FiPackage, FiRepeat,
  FiExternalLink, FiBarChart2, FiMapPin, FiCreditCard, FiCompass,
} from 'react-icons/fi'
import { FaInstagram, FaFacebookF, FaGoogle, FaWhatsapp, FaYoutube } from 'react-icons/fa'

// brand colour + icon for each acquisition channel
const SOURCE_META = {
  Instagram: { icon: FaInstagram, color: '#0277BD' },
  Facebook: { icon: FaFacebookF, color: '#0277BD' },
  Google: { icon: FaGoogle, color: '#0288D1' },
  WhatsApp: { icon: FaWhatsapp, color: '#00B4D8' },
  YouTube: { icon: FaYoutube, color: '#0277BD' },
  Direct: { icon: FiCompass, color: '#4E7F98' },
}

/*
  Sales analytics from the database (exact numbers). Visitor behaviour —
  traffic, funnels, session replays — lives in PostHog; the card at the top
  links out rather than duplicating approximate numbers here.
*/

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')

const ORDERS_SERIES = [
  { key: 'completed', name: 'Completed', gradient: 'linear-gradient(180deg,#90E0EF,#0277BD)', color: '#00B4D8' },
  { key: 'cancelled', name: 'Cancelled', gradient: 'linear-gradient(180deg,#90E0EF,#0277BD)', color: '#0277BD' },
]

function Card({ title, action, className = '', children }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`}>
      {title && <div className="flex items-center justify-between mb-4"><h2 className="font-display font-semibold text-ink-900">{title}</h2>{action}</div>}
      {children}
    </div>
  )
}

export default function AdminAnalytics() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchAnalytics().then((res) => {
      if (cancelled) return
      if (res.error) setError(res.error)
      else setStats(res.stats)
    })
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <AdminLayout title="Analytics" subtitle="Sales performance">
        <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm" role="alert">Couldn't load analytics: {error}</div>
      </AdminLayout>
    )
  }

  if (!stats) {
    return (
      <AdminLayout title="Analytics" subtitle="Sales performance">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 h-28 animate-pulse" />
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mt-4 h-64 animate-pulse" />
      </AdminLayout>
    )
  }

  const kpis = [
    { icon: FiDollarSign, label: 'Total revenue', value: inr(stats.revenue), tint: 'bg-emerald-50 text-emerald-600' },
    { icon: FiShoppingBag, label: `Completed orders (${stats.cancelled} cancelled)`, value: stats.completedOrders, tint: 'bg-primary-50 text-primary-700' },
    { icon: FiTrendingUp, label: 'Average order value', value: inr(stats.aov), tint: 'bg-secondary-50 text-secondary-600' },
    { icon: FiPackage, label: 'Units sold', value: stats.unitsSold, tint: 'bg-amber-50 text-amber-600' },
  ]

  const maxProd = stats.topProducts[0]?.revenue || 1
  const maxBrand = stats.topBrands[0]?.revenue || 1
  const maxCat = stats.byCategory[0]?.revenue || 1
  const maxCity = stats.byCity[0]?.orders || 1

  return (
    <AdminLayout title="Analytics" subtitle="Sales performance — exact numbers from your database">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.tint}`}><k.icon size={20} /></span>
            <div className="mt-3 text-xl font-bold text-ink-900">{k.value}</div>
            <div className="text-xs text-gray-400">{k.label}</div>
          </div>
        ))}
      </div>

      {/* profit — from private per-product cost prices */}
      <div className="mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <div className="text-xs text-gray-400 flex items-center gap-1.5"><FiTrendingUp size={13} className="text-emerald-600" /> Gross profit</div>
            <div className="mt-1 text-2xl font-bold text-emerald-600">
              {stats.costCoverage > 0 ? inr(Math.round(stats.grossProfit)) : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Profit margin</div>
            <div className="mt-1 text-2xl font-bold text-ink-900">
              {stats.profitMargin !== null ? `${stats.profitMargin}%` : '—'}
            </div>
          </div>
          <div className="flex-1 min-w-[240px]">
            {stats.costCoverage === 0 ? (
              <p className="text-sm text-gray-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Add a <span className="font-semibold">cost price</span> to your products (Products → edit) to see profit &amp; margin here.
              </p>
            ) : stats.costCoverage < 0.999 ? (
              <p className="text-sm text-gray-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Based on the <span className="font-semibold">{Math.round(stats.costCoverage * 100)}%</span> of sales that have a cost price entered.
                Add cost prices to the rest for a complete figure.
              </p>
            ) : (
              <p className="text-sm text-gray-400">Revenue minus product cost across all completed orders. Excludes shipping &amp; fees.</p>
            )}
          </div>
        </div>
      </div>

      {/* visitor analytics live in PostHog */}
      <div className="mt-4 bg-gradient-to-br from-ink-950 via-primary-950 to-ink-950 text-white rounded-2xl p-5 flex flex-wrap items-center gap-4">
        <span className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <FiBarChart2 size={22} className="text-secondary-300" />
        </span>
        <div className="flex-1 min-w-[220px]">
          <div className="font-semibold">Visitor analytics live in PostHog</div>
          <p className="text-sm text-dia-mint/70">
            Traffic, conversion funnels (visited → viewed → added to cart → bought) and session replays.
            This page sticks to exact sales numbers from the database.
          </p>
        </div>
        <a
          href="https://us.posthog.com"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 bg-white text-ink-900 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-primary-50 transition-colors"
        >
          Open PostHog <FiExternalLink size={14} />
        </a>
      </div>

      {/* revenue trend + orders per month */}
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card title="Daily revenue" action={<span className="text-xs text-gray-400">Last 30 days</span>}>
          <AreaChart values={stats.daily.map((d) => d.revenue)} stroke="#00B4D8" gradientId="dailyRevGrad" />
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>{stats.daily[0].label}</span>
            <span>{stats.daily[14].label}</span>
            <span>{stats.daily[29].label}</span>
          </div>
        </Card>
        <Card title="Orders per month" action={<span className="text-xs text-gray-400">Last 6 months</span>}>
          <StackedBars data={stats.monthly} series={ORDERS_SERIES} />
        </Card>
      </div>

      {/* products + brands */}
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card title="Top products by revenue">
          {stats.topProducts.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No sales yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.topProducts.map((p) => (
                <BarRow key={p.name} label={p.name} sub={p.brand} value={p.revenue} max={maxProd}
                  valueLabel={`${p.units} sold · ${inr(p.revenue)}${p.hasCost && p.profit > 0 ? ` · +${inr(Math.round(p.profit))}` : ''}`} color="#00B4D8" />
              ))}
            </div>
          )}
        </Card>
        <Card title="Top brands by revenue">
          {stats.topBrands.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No sales yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.topBrands.map((b) => (
                <BarRow key={b.brand} label={b.brand} value={b.revenue} max={maxBrand}
                  valueLabel={`${b.units} sold · ${inr(b.revenue)}`} color="#02629C" />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* where buyers came from (acquisition source) */}
      <div className="mt-4">
        <Card
          title="Where buyers came from"
          action={<span className="text-xs text-gray-400 flex items-center gap-1"><FiCompass size={12} /> First touch, from paying customers</span>}
        >
          {stats.bySource.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No sales yet — channels appear once orders come in.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
              {stats.bySource.map((s) => {
                const meta = SOURCE_META[s.source] || { icon: FiCompass, color: '#4E7F98' }
                const pct = Math.round((s.orders / stats.completedOrders) * 100)
                return (
                  <div key={s.source} className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: meta.color }}>
                      <meta.icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-sm font-medium text-ink-900 truncate">{s.source}</span>
                        <span className="text-xs text-gray-500 whitespace-nowrap">{s.orders} · {pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{inr(s.revenue)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100">
            This tracks channels for customers who <span className="font-medium">bought</span>. For all-visitor traffic
            (including people who didn&rsquo;t buy), open PostHog above.
          </p>
        </Card>
      </div>

      {/* categories + cities + payment split */}
      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card title="Revenue by category">
          {stats.byCategory.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No sales yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.byCategory.map((c) => (
                <BarRow key={c.category} label={c.category} value={c.revenue} max={maxCat}
                  valueLabel={inr(c.revenue)} color="#0277BD" />
              ))}
            </div>
          )}
        </Card>

        <Card title="Buyers by city" action={<span className="text-xs text-gray-400 flex items-center gap-1"><FiMapPin size={12} /> From delivery addresses</span>}>
          {stats.byCity.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No orders yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.byCity.map((c) => (
                <BarRow key={c.city} label={c.city} sub={c.state} value={c.orders} max={maxCity}
                  valueLabel={`${c.orders} order${c.orders === 1 ? '' : 's'} · ${inr(c.revenue)}`} color="#00B4D8" />
              ))}
            </div>
          )}
        </Card>

        <Card title="Payment split">
          {stats.completedOrders === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No orders yet.</p>
          ) : (
            <div className="space-y-4">
              {[
                { label: 'Cash on Delivery', count: stats.codOrders, color: '#00B4D8' },
                { label: 'Paid Online', count: stats.onlineOrders, color: '#0277BD' },
              ].map((m) => {
                const pct = Math.round((m.count / stats.completedOrders) * 100)
                return (
                  <div key={m.label}>
                    <div className="flex justify-between items-baseline mb-1 text-sm">
                      <span className="text-ink-900 font-medium flex items-center gap-1.5">
                        <FiCreditCard size={13} className="text-gray-400" /> {m.label}
                      </span>
                      <span className="text-xs text-gray-500">{m.count} · {pct}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: m.color }} />
                    </div>
                  </div>
                )
              })}
              <div className="flex items-center gap-2 text-xs text-gray-400 pt-2 border-t border-gray-100">
                <FiRepeat size={12} /> {stats.repeatBuyers} repeat buyer{stats.repeatBuyers === 1 ? '' : 's'}
              </div>
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  )
}
