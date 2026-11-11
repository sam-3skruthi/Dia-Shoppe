import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import PageBackdrop from '../components/PageBackdrop'
import { Reveal, Stagger, StaggerItem } from '../components/motion'
import { fetchMyOrders, cancelMyOrder, canCancel, CANCEL_REASONS } from '../lib/orders'
import { useAuth } from '../context/AuthContext'
import {
  FiPackage, FiChevronRight, FiShoppingBag, FiCheckCircle, FiCalendar, FiXCircle,
} from 'react-icons/fi'

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/* Cancel dialog — reason is required so the admin list shows WHY */
function CancelDialog({ order, onClose, onCancelled }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const full = reason === 'Other' && note.trim() ? note.trim() : reason
    const { error: err } = await cancelMyOrder(order.id, full)
    setBusy(false)
    if (err) { setError(err); return }
    onCancelled(order.id, full)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={submit} className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="font-display text-xl font-semibold text-ink-900">Cancel this order?</h2>
        <p className="text-sm text-gray-500 mt-1">
          Order {order.id} · ₹{order.totals.total.toLocaleString('en-IN')}
        </p>

        <fieldset className="mt-4 space-y-2">
          <legend className="text-sm font-medium text-gray-600 mb-2">Please tell us why</legend>
          {CANCEL_REASONS.map((r) => (
            <label key={r} className={`flex items-center gap-2.5 border rounded-xl px-3 py-2 cursor-pointer text-sm transition-colors ${
              reason === r ? 'border-secondary-500 bg-secondary-50' : 'border-gray-200 hover:border-gray-300'
            }`}>
              <input type="radio" name="reason" value={r} required checked={reason === r}
                onChange={() => setReason(r)} className="w-4 h-4 accent-primary-800" />
              {r}
            </label>
          ))}
        </fieldset>

        {reason === 'Other' && (
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Tell us a little more…"
            className="mt-3 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300"
          />
        )}

        {error && <p className="text-sm text-red-600 mt-3" role="alert">{error}</p>}

        <p className="text-xs text-gray-400 mt-4">
          Items go back into stock immediately. If you already paid, the refund is processed to your original payment method.
        </p>

        <div className="flex justify-end gap-3 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100">
            Keep order
          </button>
          <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
            {busy ? 'Cancelling…' : 'Cancel order'}
          </button>
        </div>
      </form>
    </div>
  )
}

function OrderCard({ order, onCancelled }) {
  const itemCount = order.items.reduce((n, i) => n + i.qty, 0)
  const preview = order.items.slice(0, 2).map((i) => i.name).join(', ')
  const more = order.items.length - 2
  const [dialog, setDialog] = useState(false)
  const cancellable = canCancel(order.statusRaw)

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
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full ${
          order.statusRaw === 'cancelled' ? 'text-red-600 bg-red-50' : 'text-secondary-700 bg-secondary-50'
        }`}>
          {order.statusRaw === 'cancelled' ? <FiXCircle size={13} /> : <FiCheckCircle size={13} />} {order.status}
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

      {/* cancel — only before the parcel ships */}
      {cancellable && (
        <div className="pt-3 mt-3 border-t border-gray-50 flex justify-end">
          <button
            onClick={() => setDialog(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-red-600 transition-colors"
          >
            <FiXCircle size={14} /> Cancel order
          </button>
        </div>
      )}
      {order.statusRaw === 'cancelled' && order.cancellationReason && (
        <p className="pt-3 mt-3 border-t border-gray-50 text-xs text-gray-400">
          Cancelled — {order.cancellationReason}
        </p>
      )}

      {dialog && (
        <CancelDialog order={order} onClose={() => setDialog(false)} onCancelled={(id, reason) => { setDialog(false); onCancelled(id, reason) }} />
      )}
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
            <div key={i} className="h-32 rounded-2xl bg-primary-100/70 animate-pulse" />
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
          <div className="w-20 h-20 rounded-full bg-white/80 border border-primary-200 flex items-center justify-center mb-5">
            <FiPackage size={34} className="text-primary-700" />
          </div>
          <h1 className="font-display text-3xl font-semibold text-dia-ink mb-2">No orders yet</h1>
          <p className="text-dia-ink/65 mb-6 max-w-sm">When you place an order, it’ll show up here so you can track and revisit it anytime.</p>
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
      <section className="relative text-dia-ink">
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Reveal>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-tight">My Orders</h1>
            <p className="text-dia-ink/65 mt-2">{orders.length} {orders.length === 1 ? 'order' : 'orders'} placed</p>
          </Reveal>
        </div>
      </section>

      <section className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 sm:pb-28">
        <Stagger className="space-y-4">
          {orders.map((o) => (
            <StaggerItem key={o.id}>
              <OrderCard
                order={o}
                onCancelled={(id, reason) =>
                  setOrders((list) =>
                    list.map((x) =>
                      x.id === id
                        ? { ...x, status: 'Cancelled', statusRaw: 'cancelled', cancellationReason: reason }
                        : x
                    )
                  )
                }
              />
            </StaggerItem>
          ))}
        </Stagger>

        <Link to="/products" className="inline-flex items-center gap-2 text-primary-700 font-semibold text-sm hover:text-ink-950 transition-colors mt-8">
          <FiShoppingBag size={16} /> Continue shopping
        </Link>
      </section>

      <Footer />
    </div>
  )
}
