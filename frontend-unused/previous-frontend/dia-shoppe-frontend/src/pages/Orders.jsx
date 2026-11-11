import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import PageBackdrop from '../components/PageBackdrop'
import { Reveal, Stagger, StaggerItem } from '../components/motion'
import { fetchMyOrders } from '../lib/orders'
import { useAuth } from '../context/AuthContext'
import {
  FiPackage, FiChevronRight, FiShoppingBag, FiCheckCircle, FiCalendar,
} from 'react-icons/fi'

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function OrderCard({ order }) {
  const itemCount = order.items.reduce((n, i) => n + i.qty, 0)
  const preview = order.items.slice(0, 2).map((i) => i.name).join(', ')
  const more = order.items.length - 2

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 sm:p-6">
      {/* top row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary-50 flex items-center justify-center shrink-0">
            <FiPackage className="text-secondary-500" size={20} />
          </div>
          <div>
            <div className="font-semibold text-ink-900 text-sm">{order.id}</div>
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <FiCalendar size={12} /> {fmtDate(order.date)}
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary-700 bg-secondary-50 px-3 py-1 rounded-full">
          <FiCheckCircle size={13} /> {order.status}
        </span>
      </div>

      {/* body */}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          <div className="text-sm text-gray-600 leading-snug">
            {preview}{more > 0 ? ` +${more} more` : ''}
          </div>
          <div className="text-xs text-gray-400 mt-1">{itemCount} {itemCount === 1 ? 'item' : 'items'}</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-gray-400">Total</div>
            <div className="font-bold text-primary-700">₹{order.totals.total.toLocaleString()}</div>
          </div>
          <Link
            to={`/order-confirmation/${order.id}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:underline whitespace-nowrap"
          >
            View Details <FiChevronRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function Orders() {
  const { user, loading: authLoading } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetchMyOrders().then(({ orders: list }) => {
      if (cancelled) return
      setOrders(list)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user])

  // wait for the session to restore before deciding on redirects
  if (authLoading) return null

  // order history lives behind the profile — require login
  if (!user) return <Navigate to="/login" state={{ from: '/orders' }} replace />

  /* loading state */
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <PageBackdrop />
        <Header />
        <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-16 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-white/10 animate-pulse" />
          ))}
        </div>
        <Footer />
      </div>
    )
  }

  /* empty state */
  if (orders.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <PageBackdrop />
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-32">
          <div className="w-20 h-20 rounded-full bg-white/10 border border-white/15 flex items-center justify-center mb-5">
            <FiPackage size={34} className="text-secondary-300" />
          </div>
          <h1 className="font-display text-3xl font-semibold text-white mb-2">No orders yet</h1>
          <p className="text-blue-100/80 mb-6 max-w-sm">When you place an order, it’ll show up here so you can track and revisit it anytime.</p>
          <Link to="/products" className="inline-flex items-center gap-2 bg-secondary-500 text-white px-6 py-3 rounded-full font-semibold hover:bg-secondary-600 transition-colors">
            <FiShoppingBag size={18} /> Start shopping
          </Link>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <PageBackdrop />
      <Header />

      {/* header band — transparent over the navy backdrop */}
      <section className="relative text-white">
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Reveal>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-tight">My Orders</h1>
            <p className="text-blue-100/85 mt-2">{orders.length} {orders.length === 1 ? 'order' : 'orders'} placed</p>
          </Reveal>
        </div>
      </section>

      <section className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 sm:pb-28">
        <Stagger className="space-y-4">
          {orders.map((o) => (
            <StaggerItem key={o.id}><OrderCard order={o} /></StaggerItem>
          ))}
        </Stagger>

        <Link to="/products" className="inline-flex items-center gap-2 text-secondary-200 font-semibold text-sm hover:text-white transition-colors mt-8">
          <FiShoppingBag size={16} /> Continue shopping
        </Link>
      </section>

      <Footer />
    </div>
  )
}
