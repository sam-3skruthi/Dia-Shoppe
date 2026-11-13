import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { Reveal, motion } from '../components/motion'
import { fetchOrder, onOrderChange } from '../lib/orders'
import { fetchOrderFeedback, submitFeedback } from '../lib/feedback'
import { useAuth } from '../context/AuthContext'
import PageBackdrop from '../components/PageBackdrop'
import {
  FiCheckCircle, FiPackage, FiTruck, FiMapPin, FiCreditCard,
  FiArrowRight, FiShoppingBag, FiClock, FiHome, FiXCircle, FiStar,
} from 'react-icons/fi'

/* ── live tracking timeline ─────────────────────── */

const TRACKING_STEPS = [
  { key: 'placed',    label: 'Order Placed', icon: FiPackage },
  { key: 'confirmed', label: 'Confirmed',    icon: FiCheckCircle },
  { key: 'shipped',   label: 'Shipped',      icon: FiTruck },
  { key: 'delivered', label: 'Delivered',    icon: FiHome },
]

// how far along the timeline each DB status is (index into TRACKING_STEPS)
const STATUS_PROGRESS = { pending: 0, paid: 0, confirmed: 1, shipped: 2, delivered: 3 }

function OrderTimeline({ order }) {
  if (order.statusRaw === 'cancelled') {
    return (
      <div className="mt-6 bg-white rounded-2xl border border-red-100 shadow-sm p-6 flex items-center gap-3">
        <FiXCircle size={24} className="text-red-400 shrink-0" />
        <div>
          <div className="font-semibold text-ink-900">Order Cancelled</div>
          <div className="text-sm text-gray-500">This order was cancelled. If you were charged, the amount will be refunded.</div>
        </div>
      </div>
    )
  }

  const progress = STATUS_PROGRESS[order.statusRaw] ?? 0

  return (
    <div className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="flex items-center justify-between font-display text-xl font-semibold text-ink-900 mb-6">
        Track Your Order
        <span className="flex items-center gap-1.5 text-xs font-medium text-secondary-600 bg-secondary-50 px-2.5 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary-500 animate-pulse" /> Live
        </span>
      </h2>

      <div className="flex items-start">
        {TRACKING_STEPS.map((step, i) => {
          const done = i <= progress
          const isLast = i === TRACKING_STEPS.length - 1
          const Icon = step.icon
          return (
            <div key={step.key} className={`flex items-start ${isLast ? '' : 'flex-1'}`}>
              <div className="flex flex-col items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    done ? 'bg-secondary-500 text-white' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  <Icon size={18} />
                </div>
                <span className={`mt-2 text-[11px] sm:text-xs font-medium text-center leading-tight ${done ? 'text-ink-900' : 'text-gray-400'}`}>
                  {step.label}
                </span>
              </div>
              {!isLast && (
                <div className={`flex-1 h-1 rounded-full mt-[18px] mx-1 sm:mx-2 ${i < progress ? 'bg-secondary-500' : 'bg-gray-100'}`} />
              )}
            </div>
          )
        })}
      </div>

      {order.statusRaw === 'pending' && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mt-5">
          <FiClock size={13} /> Awaiting payment confirmation.
        </p>
      )}

      {(order.courier || order.trackingNumber) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm bg-secondary-50/60 rounded-xl px-4 py-3 mt-5">
          <span className="flex items-center gap-1.5 text-gray-600">
            <FiTruck size={15} className="text-secondary-500" />
            <span className="font-medium text-ink-900">{order.courier || 'Courier'}</span>
          </span>
          {order.trackingNumber && (
            <span className="text-gray-600">
              Tracking No: <span className="font-mono font-medium text-ink-900">{order.trackingNumber}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ── post-delivery review ───────────────────────── */

function ReviewSection({ order }) {
  const { user } = useAuth()
  const [existing, setExisting] = useState(null)
  const [checked, setChecked] = useState(false)
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchOrderFeedback(order.id).then(({ feedback }) => {
      if (cancelled) return
      setExisting(feedback)
      setChecked(true)
    })
    return () => { cancelled = true }
  }, [order.id])

  if (!checked || !user) return null

  const handleSubmit = async () => {
    if (!rating) { setError('Please pick a star rating first.'); return }
    setSubmitting(true)
    setError(null)
    const res = await submitFeedback({ userId: user.id, orderId: order.id, rating, comment })
    setSubmitting(false)
    if (res.error) setError(res.error)
    else setExisting(res.feedback)
  }

  if (existing) {
    return (
      <Reveal className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900 mb-2">
          <FiStar className="text-yellow-400 fill-yellow-400" /> Your Review
        </h2>
        <div className="flex gap-1 mb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <FiStar key={i} size={20} className={i < existing.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'} />
          ))}
        </div>
        {existing.comment && <p className="text-sm text-gray-600 leading-relaxed">"{existing.comment}"</p>}
        <p className="text-xs text-gray-400 mt-2">Thanks for your feedback!</p>
      </Reveal>
    )
  }

  return (
    <Reveal className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900 mb-1">
        <FiStar className="text-secondary-500" /> How was your order?
      </h2>
      <p className="text-sm text-gray-500 mb-4">Your order was delivered — rate your experience to help other customers.</p>

      <div className="flex gap-1.5 mb-4" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            onClick={() => setRating(star)}
            onMouseEnter={() => setHovered(star)}
            className="p-0.5 transition-transform hover:scale-110 active:scale-95"
          >
            <FiStar
              size={28}
              className={star <= (hovered || rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}
            />
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        maxLength={500}
        placeholder="Tell us about the product and delivery (optional)…"
        className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 resize-none"
      />

      {error && <p className="text-sm text-red-500 mt-2" role="alert">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-3 inline-flex items-center gap-2 bg-primary-700 text-white font-semibold px-6 py-2.5 rounded-full hover:bg-primary-800 transition-colors disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : 'Submit Review'}
      </button>
    </Reveal>
  )
}

const fmtDate = (iso, addDays = 0) => {
  const d = new Date(iso)
  d.setDate(d.getDate() + addDays)
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function OrderConfirmation() {
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetchOrder(id).then(({ order: o }) => {
        if (cancelled) return
        setOrder(o)
        setLoading(false)
      })
    load()
    // live tracking: refetch whenever a worker updates this order's status
    const unsubscribe = onOrderChange(id, load)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <PageBackdrop />
        <Header />
        <div className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-16 space-y-6">
          <div className="w-20 h-20 mx-auto rounded-full bg-white/10 animate-pulse" />
          <div className="h-8 w-2/3 mx-auto rounded-xl bg-white/10 animate-pulse" />
          <div className="h-40 rounded-2xl bg-white/10 animate-pulse" />
        </div>
        <Footer />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col">
        <PageBackdrop />
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-32">
          <h1 className="font-display text-3xl font-semibold text-white mb-3">Order not found</h1>
          <p className="text-blue-100/80 mb-6">We couldn’t find that order. Make sure you’re signed in with the account that placed it.</p>
          <Link to="/products" className="inline-flex items-center gap-2 bg-primary-700 text-white px-6 py-3 rounded-full font-semibold hover:bg-primary-800 transition-colors">
            <FiShoppingBag size={18} /> Continue shopping
          </Link>
        </div>
        <Footer />
      </div>
    )
  }

  const c = order.customer
  const t = order.totals

  return (
    <div className="min-h-screen">
      {/* testimonials-style navy backdrop */}
      <PageBackdrop />
      <Header />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* success hero */}
        <Reveal className="text-center">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 16 }}
            className="w-20 h-20 mx-auto rounded-full bg-secondary-50 flex items-center justify-center mb-5"
          >
            <FiCheckCircle size={44} className="text-secondary-500" />
          </motion.div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white">Order Confirmed!</h1>
          <p className="text-blue-100/80 mt-2">Thank you, {c.name?.split(' ')[0] || 'there'}. We’ve received your order and will start preparing it right away.</p>
          <div className="inline-flex items-center gap-2 mt-4 bg-white border border-gray-100 shadow-sm rounded-full px-4 py-2 text-sm">
            <span className="text-gray-500">Order ID</span>
            <span className="font-bold text-primary-700">{order.id}</span>
          </div>
        </Reveal>

        {/* live tracking timeline */}
        <Reveal>
          <OrderTimeline order={order} />
        </Reveal>

        {/* review — opens once the order is delivered */}
        {order.statusRaw === 'delivered' && <ReviewSection order={order} />}

        {/* delivery estimate */}
        <Reveal className="mt-8 bg-gradient-to-br from-ink-950 via-primary-950 to-ink-950 text-white rounded-2xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <FiTruck size={24} className="text-secondary-300" />
          </div>
          <div>
            <div className="text-sm text-blue-100/70">Estimated delivery</div>
            <div className="font-semibold text-lg">{fmtDate(order.date, 3)} – {fmtDate(order.date, 5)}</div>
          </div>
        </Reveal>

        {/* items */}
        <Reveal className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900 mb-4">
            <FiPackage className="text-secondary-500" /> Order Items
          </h2>
          <div className="divide-y divide-gray-100">
            {order.items.map((i) => (
              <div key={i.id} className="flex justify-between gap-3 py-3 text-sm">
                <span className="text-gray-700 leading-snug">
                  {i.name} <span className="text-gray-400">× {i.qty}</span>
                </span>
                <span className="font-medium text-ink-900 whitespace-nowrap">₹{(i.price * i.qty).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 mt-3 pt-3 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>₹{t.subtotal.toLocaleString()}</span></div>
            {t.savings > 0 && <div className="flex justify-between text-secondary-600"><span>You saved</span><span>– ₹{t.savings.toLocaleString()}</span></div>}
            <div className="flex justify-between text-gray-600"><span>Delivery</span><span>{t.shipping === 0 ? 'Free' : `₹${t.shipping}`}</span></div>
            <div className="flex justify-between font-semibold text-ink-900 text-base pt-1"><span>Total Paid</span><span className="text-primary-700">₹{t.total.toLocaleString()}</span></div>
          </div>
        </Reveal>

        {/* address + payment */}
        <div className="grid sm:grid-cols-2 gap-6 mt-6">
          <Reveal className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900 mb-3">
              <FiMapPin className="text-secondary-500" /> Delivery Address
            </h2>
            <div className="text-sm text-gray-600 leading-relaxed">
              <div className="font-medium text-ink-900">{c.name}</div>
              <div>{c.address}{c.landmark ? `, ${c.landmark}` : ''}</div>
              <div>{c.city}, {c.state} – {c.pincode}</div>
              <div className="mt-1">{c.phone}</div>
            </div>
          </Reveal>
          <Reveal className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900 mb-3">
              <FiCreditCard className="text-secondary-500" /> Payment Method
            </h2>
            <div className="text-sm text-gray-600">{order.payment}</div>
          </Reveal>
        </div>

        {/* actions */}
        <div className="flex flex-wrap justify-center gap-3 mt-8">
          <Link to="/orders" className="inline-flex items-center gap-2 bg-primary-700 text-white font-semibold px-6 py-3 rounded-full hover:bg-primary-800 transition-colors">
            View My Orders <FiArrowRight size={16} />
          </Link>
          <Link to="/products" className="inline-flex items-center gap-2 bg-white border border-gray-200 text-ink-900 font-semibold px-6 py-3 rounded-full hover:border-secondary-300 transition-colors">
            Continue Shopping
          </Link>
        </div>
      </div>

      <Footer />
    </div>
  )
}
