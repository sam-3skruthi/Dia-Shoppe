import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { Reveal, motion } from '../components/motion'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { createOrder } from '../lib/orders'
import { payForOrder } from '../lib/razorpay'
import PageBackdrop from '../components/PageBackdrop'
import {
  FiUser, FiMapPin, FiCreditCard, FiLock, FiArrowLeft,
  FiTruck, FiShield, FiCheckCircle, FiMessageCircle,
} from 'react-icons/fi'

const PAYMENT_METHODS = [
  { value: 'cod', label: 'Cash on Delivery', note: 'Pay when your order arrives' },
  { value: 'online', label: 'Pay Online', note: 'UPI, Cards, Net Banking & Wallets — secured by Razorpay' },
]

const FREE_SHIP_OVER = 2000
const SHIP_FEE = 99

function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <input
        {...props}
        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-secondary-400 focus:border-secondary-400"
      />
    </label>
  )
}

export default function Checkout() {
  const navigate = useNavigate()
  const { items, count, subtotal, savings, clear } = useCart()
  const { user, loading } = useAuth()
  const [payment, setPayment] = useState('cod')
  const [waUpdates, setWaUpdates] = useState(true)   // order-status updates on WhatsApp (transactional)
  const [waMarketing, setWaMarketing] = useState(false) // offers/promotions (explicit marketing opt-in)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState(null)
  // set when an online payment was started but not completed (cancelled modal),
  // so retrying pays for the same order instead of creating a duplicate
  const [pendingOrderId, setPendingOrderId] = useState(null)

  useEffect(() => {
    track('checkout_started', { items: count, subtotal })
    // fire once per checkout visit, not on every cart tweak
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // wait for the session to restore before deciding on redirects
  if (loading) return null

  // orders belong to an account — require login first
  if (!user) return <Navigate to="/login" state={{ from: '/checkout' }} replace />

  // empty cart → bounce back to the cart (but not while we're placing an order,
  // since clearing the cart would otherwise redirect before the confirmation nav)
  if (items.length === 0 && !placing) return <Navigate to="/cart" replace />

  const shipping = subtotal >= FREE_SHIP_OVER ? 0 : SHIP_FEE
  const total = subtotal + shipping

  const placeOrder = async (e) => {
    e.preventDefault()
    setPlacing(true)
    setError(null)
    const form = Object.fromEntries(new FormData(e.target).entries())

    let orderId = pendingOrderId
    if (!orderId) {
      const { order, error: orderError } = await createOrder({
        userId: user.id,
        items,
        form,
        paymentMethod: payment,
        total,
        whatsappOptIn: waUpdates,
        marketingOptIn: waMarketing,
      })
      if (orderError) {
        setError(orderError)
        setPlacing(false)
        return
      }
      orderId = order.id
    }

    // COD: order is confirmed immediately — done
    if (payment === 'cod') {
      track('order_placed', { order_id: orderId, payment_method: 'cod', total, items: count })
      clear()
      navigate(`/order-confirmation/${orderId}`)
      return
    }

    // Online payment: open the Razorpay modal, then verify server-side
    setPendingOrderId(orderId)
    const result = await payForOrder({
      orderId,
      email: form.email,
      name: form.name,
      phone: form.phone,
    })
    if (result.success) {
      track('order_placed', { order_id: orderId, payment_method: 'online', total, items: count })
      clear()
      navigate(`/order-confirmation/${orderId}`)
      return
    }
    setPlacing(false)
    if (result.cancelled) {
      setError('Payment was cancelled. Click "Place Order" again to retry, or switch to Cash on Delivery.')
    } else {
      setError(result.error || 'Payment failed. Please try again.')
    }
  }

  return (
    <div className="min-h-screen">
      {/* testimonials-style navy backdrop */}
      <PageBackdrop />
      <Header />

      {/* header band — transparent, sits on the page backdrop */}
      <section className="relative text-white">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Reveal>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-tight">Checkout</h1>
            <p className="text-blue-100/85 mt-2">Almost there — just a few details to complete your order.</p>
          </Reveal>
        </div>
      </section>

      <form onSubmit={placeOrder} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* left: details */}
          <div className="lg:col-span-2 space-y-6">
            {/* contact */}
            <Reveal className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900 mb-4">
                <FiUser className="text-secondary-500" /> Contact Information
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Full Name" name="name" required placeholder="Ramesh Kumar" defaultValue={user.name || ''} />
                {/* Indian mobiles are 10 digits starting 6-9; an optional +91/0
                    prefix is allowed. Catches typos that would silently break
                    the WhatsApp order updates. */}
                <Field
                  label="Phone Number"
                  name="phone"
                  type="tel"
                  required
                  inputMode="tel"
                  placeholder="98765 43210"
                  pattern="(\+?91[\-\s]?|0)?[6-9][0-9]{9}"
                  title="Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9"
                  onInput={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').replace(/^(91|0)/, '')
                    e.target.setCustomValidity(
                      digits.length === 10 && /^[6-9]/.test(digits)
                        ? ''
                        : 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9 — we send order updates to it.'
                    )
                  }}
                />
                <div className="sm:col-span-2">
                  <Field label="Email Address" name="email" type="email" required placeholder="you@example.com" defaultValue={user.email || ''} />
                </div>
              </div>
            </Reveal>

            {/* shipping */}
            <Reveal className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900 mb-4">
                <FiMapPin className="text-secondary-500" /> Shipping Address
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Address" name="address" required placeholder="House no, street, area" />
                </div>
                <Field label="City" name="city" required placeholder="Bengaluru" />
                <Field label="State" name="state" required placeholder="Karnataka" />
                <Field label="PIN Code" name="pincode" required placeholder="560001" inputMode="numeric" />
                <Field label="Landmark (optional)" name="landmark" placeholder="Near..." />
              </div>
            </Reveal>

            {/* payment */}
            <Reveal className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900 mb-4">
                <FiCreditCard className="text-secondary-500" /> Payment Method
              </h2>
              <div className="space-y-3">
                {PAYMENT_METHODS.map((m) => (
                  <label
                    key={m.value}
                    className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                      payment === m.value ? 'border-secondary-500 bg-secondary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={m.value}
                      checked={payment === m.value}
                      onChange={() => setPayment(m.value)}
                      className="w-4 h-4 accent-primary-800 focus:ring-primary-500"
                    />
                    <div>
                      <div className="text-sm font-semibold text-ink-900">{m.label}</div>
                      <div className="text-xs text-gray-400">{m.note}</div>
                    </div>
                  </label>
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-4">
                <FiLock size={13} /> Online payments are processed securely by Razorpay.
              </p>
            </Reveal>

            {/* WhatsApp consent — order updates (transactional) + marketing (explicit) */}
            <Reveal className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900 mb-4">
                <FiMessageCircle className="text-secondary-500" /> WhatsApp Updates
              </h2>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={waUpdates}
                    onChange={(e) => setWaUpdates(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-secondary-600"
                  />
                  <span className="text-sm text-gray-600 leading-snug">
                    <span className="font-semibold text-ink-900">Send my order updates on WhatsApp</span> to the
                    number above — confirmation, dispatch and delivery alerts with tracking.
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={waMarketing}
                    onChange={(e) => setWaMarketing(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-secondary-600"
                  />
                  <span className="text-sm text-gray-600 leading-snug">
                    Also send me <span className="font-semibold text-ink-900">offers, deals &amp; new-product alerts</span>{' '}
                    on WhatsApp. You can opt out anytime.
                  </span>
                </label>
              </div>
            </Reveal>

            <Link to="/cart" className="inline-flex items-center gap-2 text-secondary-200 font-semibold text-sm hover:text-white transition-colors">
              <FiArrowLeft size={16} /> Back to cart
            </Link>
          </div>

          {/* right: summary */}
          <Reveal className="lg:col-span-1">
            <div className="sticky top-24 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="font-display text-xl font-semibold text-ink-900 mb-4">Order Summary</h2>

              {/* items */}
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1 mb-4">
                {items.map((i) => (
                  <div key={i.id} className="flex justify-between gap-3 text-sm">
                    <span className="text-gray-600 leading-snug">
                      {i.name} <span className="text-gray-400">× {i.qty}</span>
                    </span>
                    <span className="font-medium text-ink-900 whitespace-nowrap">₹{(i.price * i.qty).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-3 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal ({count} {count === 1 ? 'item' : 'items'})</span>
                  <span className="font-medium text-ink-900">₹{subtotal.toLocaleString()}</span>
                </div>
                {savings > 0 && (
                  <div className="flex justify-between text-secondary-600">
                    <span>You save</span>
                    <span className="font-medium">– ₹{savings.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Delivery</span>
                  <span className="font-medium text-ink-900">{shipping === 0 ? 'Free' : `₹${shipping}`}</span>
                </div>
              </div>

              <div className="border-t border-gray-100 mt-4 pt-4 flex justify-between items-baseline">
                <span className="font-semibold text-ink-900">Total</span>
                <span className="text-2xl font-bold text-primary-700">₹{total.toLocaleString()}</span>
              </div>

              {error && (
                <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5" role="alert">
                  {error}
                </p>
              )}

              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={placing}
                className="w-full mt-5 inline-flex items-center justify-center gap-2 bg-primary-700 text-white font-semibold px-6 py-3.5 rounded-full hover:bg-primary-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FiCheckCircle size={18} /> {placing ? 'Placing order…' : 'Place Order'}
              </motion.button>

              <div className="flex items-center justify-center gap-4 mt-5 text-xs text-gray-400">
                <span className="flex items-center gap-1"><FiShield size={14} className="text-secondary-500" /> Secure</span>
                <span className="flex items-center gap-1"><FiTruck size={14} className="text-secondary-500" /> Fast delivery</span>
              </div>
            </div>
          </Reveal>
        </div>
      </form>

      <Footer />
    </div>
  )
}
