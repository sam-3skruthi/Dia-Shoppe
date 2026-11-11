import { Link, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { Reveal, Stagger, StaggerItem, motion } from '../components/motion'
import { useCart } from '../context/CartContext'
import { getCategory } from '../data/products'
import PageBackdrop from '../components/PageBackdrop'
import DealsMarquee from '../components/DealsMarquee'
import CartSaleStrip from '../components/CartSaleStrip'
import {
  FiMinus, FiPlus, FiTrash2, FiShoppingCart, FiArrowRight,
  FiArrowLeft, FiShield, FiTruck,
} from 'react-icons/fi'

const FREE_SHIP_OVER = 2000
const SHIP_FEE = 99

function LineItem({ item }) {
  const { updateQty, removeItem } = useCart()
  const Icon = getCategory(item.category)?.icon
  const lineTotal = item.price * item.qty

  return (
    <div className="flex gap-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      {/* thumb */}
      <Link
        to={`/products/${item.slug}`}
        className="shrink-0 w-24 h-24 rounded-xl bg-secondary-50 flex items-center justify-center"
      >
        {Icon && <Icon className="text-secondary-500" size={34} />}
      </Link>

      {/* details */}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400">{item.brand}</div>
        <Link
          to={`/products/${item.slug}`}
          className="font-semibold text-ink-900 text-sm leading-snug hover:text-primary-700 transition-colors line-clamp-2"
        >
          {item.name}
        </Link>

        <div className="flex items-center gap-2 mt-1">
          <span className="font-bold text-primary-700">₹{item.price.toLocaleString()}</span>
          <span className="text-xs text-gray-400 line-through">₹{item.originalPrice.toLocaleString()}</span>
        </div>

        <div className="flex items-center justify-between gap-3 mt-3">
          {/* qty stepper */}
          <div className="flex items-center border border-gray-300 rounded-full overflow-hidden">
            <button
              onClick={() => updateQty(item.id, item.qty - 1)}
              disabled={item.qty <= 1}
              className="px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Decrease quantity"
            ><FiMinus size={14} /></button>
            <span className="w-9 text-center text-sm font-semibold text-ink-900">{item.qty}</span>
            <button
              onClick={() => updateQty(item.id, item.qty + 1)}
              disabled={item.qty >= item.stock}
              className="px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Increase quantity"
            ><FiPlus size={14} /></button>
          </div>

          <button
            onClick={() => removeItem(item.id)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            <FiTrash2 size={14} /> Remove
          </button>
        </div>
      </div>

      {/* line total */}
      <div className="hidden sm:flex flex-col items-end justify-center shrink-0">
        <span className="font-bold text-ink-900">₹{lineTotal.toLocaleString()}</span>
      </div>
    </div>
  )
}

export default function Cart() {
  const navigate = useNavigate()
  const { items, count, subtotal, savings, clear } = useCart()

  const shipping = subtotal >= FREE_SHIP_OVER || subtotal === 0 ? 0 : SHIP_FEE
  const total = subtotal + shipping

  /* ── empty state ── */
  if (items.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        <PageBackdrop />
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-32">
          <div className="w-20 h-20 rounded-full bg-white/80 border border-primary-200 flex items-center justify-center mb-5">
            <FiShoppingCart size={34} className="text-primary-700" />
          </div>
          <h1 className="font-display text-3xl font-semibold text-dia-ink mb-2">My cart is empty</h1>
          <p className="text-dia-ink/65 mb-6 max-w-sm">Looks like you haven’t added anything yet. Explore our authentic medical equipment and find what you need.</p>
          <Link to="/products" className="inline-flex items-center gap-2 bg-secondary-500 text-white px-6 py-3 rounded-full font-semibold hover:bg-secondary-600 transition-colors">
            <FiArrowLeft size={18} /> Start shopping
          </Link>
        </div>
        <DealsMarquee />
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* testimonials-style navy backdrop */}
      <PageBackdrop />
      <Header />

      {/* header band — transparent, sits on the page backdrop */}
      <section className="relative text-dia-ink">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Reveal>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold leading-tight">My Cart</h1>
            <p className="text-dia-ink/65 mt-2">{count} {count === 1 ? 'item' : 'items'} ready for checkout</p>
          </Reveal>
        </div>
      </section>

      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 sm:pb-28">
        {/* slim sale strip — only while the sale design is on */}
        <CartSaleStrip />

        <div className="grid lg:grid-cols-3 gap-8">
          {/* items */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-semibold text-dia-ink">Items</h2>
              <button onClick={clear} className="text-sm text-dia-ink/65 hover:text-primary-700 transition-colors">Clear cart</button>
            </div>
            <Stagger className="space-y-4">
              {items.map((item) => (
                <StaggerItem key={item.id}><LineItem item={item} /></StaggerItem>
              ))}
            </Stagger>

            <Link to="/products" className="inline-flex items-center gap-2 text-primary-700 font-semibold text-sm hover:text-ink-950 transition-colors mt-6">
              <FiArrowLeft size={16} /> Continue shopping
            </Link>
          </div>

          {/* summary */}
          <Reveal className="lg:col-span-1">
            <div className="sticky top-24 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="font-display text-xl font-semibold text-ink-900 mb-4">Order Summary</h2>

              <div className="space-y-3 text-sm">
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
                {shipping > 0 && (
                  <p className="text-xs text-gray-400">Add ₹{(FREE_SHIP_OVER - subtotal).toLocaleString()} more for free delivery</p>
                )}
              </div>

              <div className="border-t border-gray-100 mt-4 pt-4 flex justify-between items-baseline">
                <span className="font-semibold text-ink-900">Total</span>
                <span className="text-2xl font-bold text-primary-700">₹{total.toLocaleString()}</span>
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate('/checkout')}
                className="w-full mt-5 inline-flex items-center justify-center gap-2 bg-primary-700 text-white font-semibold px-6 py-3.5 rounded-full hover:bg-primary-800 transition-colors"
              >
                Proceed to Checkout <FiArrowRight size={18} />
              </motion.button>

              <div className="flex items-center justify-center gap-4 mt-5 text-xs text-gray-400">
                <span className="flex items-center gap-1"><FiShield size={14} className="text-secondary-500" /> Secure</span>
                <span className="flex items-center gap-1"><FiTruck size={14} className="text-secondary-500" /> Fast delivery</span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* today's deals / sale strip — marquee like the brand-logo bar */}
      <DealsMarquee />

      <Footer />
    </div>
  )
}
