import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { StackedBars, BarRow } from '../../components/admin/Charts'
import { fetchDashboardStats, LOW_STOCK_AT } from '../../lib/adminStats'
import { onOrdersChange } from '../../lib/orders'
import {
  FiUsers, FiShoppingBag, FiTrendingUp, FiPackage, FiStar, FiTruck,
  FiClock, FiCheckCircle, FiAlertTriangle, FiPlus, FiArrowRight,
} from 'react-icons/fi'

/*
  Dashboard on live data — orders, revenue, stock and customers straight from
  Supabase (see lib/adminStats.js). Visitor analytics arrive with PostHog;
  WhatsApp is a later phase.
*/

// bottom → top: online sits under COD in the stack
const REVENUE_SERIES = [
  { key: 'online', name: 'Paid online', gradient: 'linear-gradient(180deg,#93c5fd,#3b82f6)', color: '#3b82f6' },
  { key: 'cod', name: 'Cash on delivery', gradient: 'linear-gradient(180deg,#34d399,#059669)', color: '#10b981' },
]

const inr = (n) => '₹' + n.toLocaleString('en-IN')

const STATUS_STYLE = {
  pending: 'bg-amber-50 text-amber-600',
  paid: 'bg-blue-50 text-blue-600',
  confirmed: 'bg-secondary-50 text-secondary-700',
  shipped: 'bg-indigo-50 text-indigo-600',
  delivered: 'bg-emerald-50 text-emerald-600',
  cancelled: 'bg-red-50 text-red-500',
}

function Card({ title, action, className = '', children }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`}>
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-ink-900">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, tint }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${tint}`}><Icon size={20} /></span>
        {sub && <span className="text-xs text-gray-400">{sub}</span>}
      </div>
      <div className="mt-3 text-2xl font-bold text-ink-900">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  )
}

// Orders that need a worker to do something next
const ATTENTION = [
  { status: 'pending', label: 'Awaiting payment', icon: FiClock, tint: 'bg-amber-50 text-amber-600' },
  { status: 'paid', label: 'Paid — confirm order', icon: FiCheckCircle, tint: 'bg-blue-50 text-blue-600' },
  { status: 'confirmed', label: 'To pack & ship', icon: FiPackage, tint: 'bg-secondary-50 text-secondary-700' },
  { status: 'shipped', label: 'In transit', icon: FiTruck, tint: 'bg-indigo-50 text-indigo-600' },
]

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetchDashboardStats().then((res) => {
        if (cancelled) return
        if (res.error) setError(res.error)
        else setStats(res.stats)
      })
    load()
    const unsubscribe = onOrdersChange(load) // new/updated orders refresh the numbers live
    return () => { cancelled = true; unsubscribe() }
  }, [])

  const actions = (
    <Link to="/admin/products" className="inline-flex items-center gap-1.5 bg-primary-700 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-primary-800">
      <FiPlus size={15} /> Add Product
    </Link>
  )

  if (error) {
    return (
      <AdminLayout title="Dashboard" subtitle="Store overview">
        <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm" role="alert">Couldn't load stats: {error}</div>
      </AdminLayout>
    )
  }

  if (!stats) {
    return (
      <AdminLayout title="Dashboard" subtitle="Store overview">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 h-28 animate-pulse" />
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mt-4 h-72 animate-pulse" />
      </AdminLayout>
    )
  }

  const maxUnits = stats.topProducts[0]?.units || 1

  return (
    <AdminLayout title="Dashboard" subtitle="Store performance — live from your database" actions={actions}>
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={FiTrendingUp} label="Revenue this month" value={inr(stats.monthRevenue)} sub={`${inr(stats.totalRevenue)} all-time`} tint="bg-emerald-50 text-emerald-600" />
        <Kpi icon={FiShoppingBag} label="Orders this month" value={stats.monthOrders} sub={`${stats.totalOrders} all-time`} tint="bg-primary-50 text-primary-700" />
        <Kpi icon={FiUsers} label="Customers" value={stats.customers} tint="bg-secondary-50 text-secondary-600" />
        <Kpi icon={FiPackage} label="Live products" value={stats.liveProducts} tint="bg-amber-50 text-amber-600" />
      </div>

      {/* needs attention */}
      <Card title="Needs attention" className="mt-4"
        action={<Link to="/admin/orders" className="text-xs text-primary-700 font-semibold hover:underline inline-flex items-center gap-1">Manage orders <FiArrowRight size={12} /></Link>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ATTENTION.map(({ status, label, icon: Icon, tint }) => (
            <Link key={status} to="/admin/orders" className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 hover:border-secondary-200 hover:shadow-sm transition-all">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tint}`}><Icon size={17} /></span>
              <div className="min-w-0">
                <div className="text-lg font-bold text-ink-900 leading-tight">{stats.byStatus[status] || 0}</div>
                <div className="text-[11px] text-gray-400 leading-tight">{label}</div>
              </div>
            </Link>
          ))}
        </div>
      </Card>

      {/* revenue chart + stock alerts */}
      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card title="Revenue by month" className="lg:col-span-2"
          action={<span className="text-xs text-gray-400">Last 6 months · excludes pending & cancelled</span>}>
          <StackedBars data={stats.revenueByMonth} series={REVENUE_SERIES} valueFmt={inr} />
        </Card>

        <Card title="Stock alerts"
          action={<Link to="/admin/products" className="text-xs text-primary-700 font-semibold hover:underline">Restock</Link>}>
          {stats.lowStock.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FiCheckCircle size={28} className="text-emerald-400 mb-2" />
              <p className="text-sm text-gray-500">All live products above {LOW_STOCK_AT} in stock.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {stats.lowStock.slice(0, 6).map((p) => (
                <div key={p.id} className="flex items-center gap-2.5">
                  <FiAlertTriangle size={15} className={`shrink-0 ${p.stock_qty === 0 ? 'text-red-500' : 'text-amber-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink-900 font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-gray-400">{p.brand}</div>
                  </div>
                  <span className={`text-xs font-bold whitespace-nowrap ${p.stock_qty === 0 ? 'text-red-500' : 'text-amber-600'}`}>
                    {p.stock_qty === 0 ? 'Out' : `${p.stock_qty} left`}
                  </span>
                </div>
              ))}
              {stats.lowStock.length > 6 && (
                <div className="text-[11px] text-gray-400 pt-1">+{stats.lowStock.length - 6} more low on stock</div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* best sellers + recent orders */}
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card title="Best sellers" action={<span className="text-xs text-gray-400">By units sold</span>}>
          {stats.topProducts.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No sales yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.topProducts.map((p) => (
                <BarRow key={p.name} label={p.name} sub={p.brand}
                  value={p.units} max={maxUnits} valueLabel={`${p.units} sold · ${inr(p.revenue)}`} color="#10b981" />
              ))}
            </div>
          )}
        </Card>

        <Card title="Recent orders" action={<Link to="/admin/orders" className="text-xs text-primary-700 font-semibold hover:underline">View all</Link>}>
          {stats.recentOrders.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No orders yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="pb-2 font-medium px-1">Order</th>
                    <th className="pb-2 font-medium px-1">Customer</th>
                    <th className="pb-2 font-medium px-1 text-right">Total</th>
                    <th className="pb-2 font-medium px-1 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentOrders.map((o) => (
                    <tr key={o.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 px-1 font-medium text-ink-900">#{o.id}</td>
                      <td className="py-2.5 px-1 text-gray-600 truncate max-w-[140px]">{o.customer || '—'}</td>
                      <td className="py-2.5 px-1 text-right font-semibold text-ink-900">{inr(o.total)}</td>
                      <td className="py-2.5 px-1 text-right">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[o.status] || 'bg-gray-100 text-gray-500'}`}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* feedback */}
      <Card title="Recent feedback" className="mt-4"
        action={<Link to="/admin/reviews" className="text-xs text-primary-700 font-semibold hover:underline">All reviews</Link>}>
        {stats.feedback.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No feedback yet — customers can review after their order is delivered.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {stats.feedback.map((f, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-900">{f.name}</span>
                  <span className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <FiStar key={s} size={12} className={s < f.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'} />
                    ))}
                  </span>
                </div>
                {f.product && <div className="text-[11px] text-gray-400">{f.product}</div>}
                {f.comment && <p className="text-sm text-gray-600 mt-1 leading-snug">"{f.comment}"</p>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </AdminLayout>
  )
}
