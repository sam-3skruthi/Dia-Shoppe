import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { track } from '../lib/analytics'
import { useCart } from '../context/CartContext'
import Header from '../components/Header'
import Footer from '../components/Footer'
import ProductCard from '../components/ProductCard'
import PageBackground from '../components/PageBackground'
import { Reveal, Stagger, StaggerItem, motion } from '../components/motion'
import { getCategory } from '../data/products'
import { useCatalog } from '../context/CatalogContext'
import {
  FiStar, FiMinus, FiPlus, FiShoppingCart, FiTruck, FiShield,
  FiRefreshCw, FiCheck, FiChevronRight, FiArrowLeft, FiHome,
} from 'react-icons/fi'

/* ── helpers ─────────────────────────────────────── */

function Stars({ count, size = 16 }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <FiStar
          key={i}
          size={size}
          className={i < count ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}
        />
      ))}
    </div>
  )
}

// derive a tidy model code from the slug, e.g. "omron-hem-7120" → "HEM-7120"
const modelFrom = (slug) =>
  slug.split('-').slice(1).join('-').toUpperCase() || slug.toUpperCase()

const featuresFor = (p, catLabel) => [
  `Genuine ${p.brand} product with manufacturer warranty`,
  `Designed for accurate, everyday ${catLabel.toLowerCase()} use`,
  'Clinically reliable readings you can trust',
  'Easy to operate — suitable for home & professional care',
]

/* ── page ────────────────────────────────────────── */

export default function ProductDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { addItem } = useCart()
  const { products, loading, getProductBySlug } = useCatalog()
  const product = getProductBySlug(slug)
  const category = getCategory(product?.category)

  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [activeImg, setActiveImg] = useState(0)

  useEffect(() => {
    if (product) {
      track('product_viewed', {
        product_id: product.id,
        product_name: product.name,
        brand: product.brand,
        category: product.category,
        price: product.price,
      })
    }
  }, [product?.id])

  const related = useMemo(
    () =>
      product
        ? products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 6)
        : [],
    [product]
  )

  /* catalog still loading — brief blank state instead of a false "not found" */
  if (loading && !product) {
    return (
      <div className="min-h-screen flex flex-col">
        <PageBackground />
        <Header />
        <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
            <div className="bg-white rounded-3xl border border-gray-100 h-96 animate-pulse" />
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-100 h-8 w-2/3 animate-pulse" />
              <div className="bg-white rounded-xl border border-gray-100 h-6 w-1/3 animate-pulse" />
              <div className="bg-white rounded-xl border border-gray-100 h-24 animate-pulse" />
            </div>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  /* not found */
  if (!product) {
    return (
      <div className="min-h-screen flex flex-col">
        <PageBackground />
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-32">
          <h1 className="font-display text-3xl font-semibold text-ink-900 mb-3">Product not found</h1>
          <p className="text-gray-500 mb-6">The product you’re looking for may have been moved or sold out.</p>
          <Link to="/products" className="inline-flex items-center gap-2 bg-primary-700 text-white px-6 py-3 rounded-full font-semibold hover:bg-primary-800 transition-colors">
            <FiArrowLeft size={18} /> Back to all products
          </Link>
        </div>
        <Footer />
      </div>
    )
  }

  const discount = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
  const inStock = product.stock > 0
  const Icon = category?.icon
  const reviews = product.rating * 27 + (product.id % 7) * 4 // stable mock count
  // real photos for the gallery (migration 028); empty ⇒ category-icon placeholder
  const gallery = (product.images?.length ? product.images : [product.image]).filter(Boolean)

  // admin-entered specs win; otherwise fall back to the auto-generated table
  const specs = product.specs?.length
    ? product.specs
    : [
        { k: 'Brand', v: product.brand },
        { k: 'Model', v: modelFrom(product.slug) },
        { k: 'Category', v: category?.label || '—' },
        { k: 'Warranty', v: '1 Year Manufacturer Warranty' },
        { k: 'Country of Origin', v: 'India' },
        { k: 'In the Box', v: `${product.name}, User Manual, Warranty Card` },
      ]

  const addToCart = () => {
    addItem(product, qty)
    setAdded(true)
    setTimeout(() => setAdded(false), 1800)
  }

  const buyNow = () => {
    addItem(product, qty)
    navigate('/cart')
  }

  return (
    <div className="min-h-screen">
      <PageBackground />
      <Header />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center flex-wrap gap-1.5 text-sm text-gray-500 mb-6">
          <Link to="/" className="hover:text-primary-700 flex items-center gap-1"><FiHome size={14} /> Home</Link>
          <FiChevronRight size={14} className="text-gray-300" />
          <Link to="/products" className="hover:text-primary-700">Products</Link>
          <FiChevronRight size={14} className="text-gray-300" />
          <Link to={`/products?category=${product.category}`} className="hover:text-primary-700">{category?.label}</Link>
          <FiChevronRight size={14} className="text-gray-300" />
          <span className="text-gray-700 font-medium truncate max-w-[180px] sm:max-w-none">{product.name}</span>
        </nav>

        {/* Main: gallery + buy box */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Gallery */}
          <Reveal>
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-10">
              <div className="relative bg-secondary-50 rounded-2xl h-72 sm:h-96 flex items-center justify-center overflow-hidden">
                {gallery.length > 0 ? (
                  <motion.img
                    key={activeImg}
                    src={gallery[activeImg] || gallery[0]}
                    alt={product.name}
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <motion.div
                    key={activeImg}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                    className="w-40 h-40 bg-white rounded-3xl shadow-md flex items-center justify-center"
                  >
                    {Icon && <Icon className="text-secondary-500" size={72} />}
                  </motion.div>
                )}
                {product.badge && (
                  <span className="absolute top-4 left-4 bg-secondary-500 text-white text-xs font-semibold px-3 py-1 rounded-full">{product.badge}</span>
                )}
                {discount > 0 && (
                  <span className="absolute top-4 right-4 bg-primary-700 text-white text-xs font-semibold px-3 py-1 rounded-full">{discount}% OFF</span>
                )}
              </div>
              {/* thumbnails — one per real photo; hidden when there's only one */}
              {gallery.length > 1 && (
                <div className="flex gap-3 mt-5 flex-wrap">
                  {gallery.map((src, i) => (
                    <button
                      key={src + i}
                      onClick={() => setActiveImg(i)}
                      aria-label={`View photo ${i + 1}`}
                      className={`w-16 h-16 rounded-xl overflow-hidden bg-secondary-50 transition-all ${
                        activeImg === i ? 'ring-2 ring-secondary-500 ring-offset-2' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={src} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Reveal>

          {/* Buy box */}
          <Reveal>
            <div className="lg:py-2">
              <div className="text-sm font-semibold text-secondary-600 uppercase tracking-[0.14em] mb-2">{product.brand}</div>
              <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink-900 leading-tight">{product.name}</h1>

              <div className="flex items-center gap-3 mt-3">
                <Stars count={product.rating} />
                <span className="text-sm text-gray-500">{product.rating}.0 · {reviews} reviews</span>
              </div>

              {/* price */}
              <div className="mt-6 flex items-end gap-3">
                <span className="text-4xl font-bold text-primary-700">₹{product.price.toLocaleString()}</span>
                <span className="text-lg text-gray-400 line-through mb-1">₹{product.originalPrice.toLocaleString()}</span>
                {discount > 0 && <span className="mb-1.5 bg-secondary-50 text-secondary-700 text-sm font-semibold px-2.5 py-0.5 rounded-full">Save {discount}%</span>}
              </div>
              <p className="text-xs text-gray-400 mt-1">Inclusive of all taxes</p>

              {/* stock */}
              <div className="mt-5">
                {inStock ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary-700 bg-secondary-50 px-3 py-1.5 rounded-full">
                    <FiCheck size={15} /> {product.stock <= 5 ? `In stock — only ${product.stock} left` : 'In stock'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">Out of stock</span>
                )}
              </div>

              {/* quantity + actions */}
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <div className="flex items-center border border-gray-300 rounded-full overflow-hidden">
                  <button
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={!inStock || qty <= 1}
                    className="px-4 py-2.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Decrease quantity"
                  ><FiMinus size={16} /></button>
                  <span className="w-12 text-center font-semibold text-ink-900">{qty}</span>
                  <button
                    onClick={() => setQty((q) => Math.min(product.stock, q + 1))}
                    disabled={!inStock || qty >= product.stock}
                    className="px-4 py-2.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Increase quantity"
                  ><FiPlus size={16} /></button>
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={addToCart}
                  disabled={!inStock}
                  className="flex-1 min-w-[180px] inline-flex items-center justify-center gap-2 bg-primary-700 text-white font-semibold px-6 py-3.5 rounded-full hover:bg-primary-800 transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {added ? <><FiCheck size={18} /> Added to Cart</> : <><FiShoppingCart size={18} /> Add to Cart</>}
                </motion.button>
              </div>

              <button
                onClick={buyNow}
                disabled={!inStock}
                className="mt-3 w-full text-center bg-secondary-500 text-white font-semibold px-6 py-3.5 rounded-full hover:bg-secondary-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Buy Now
              </button>

              {/* trust badges */}
              <div className="grid grid-cols-3 gap-3 mt-8">
                {[
                  { icon: FiTruck, t: 'Fast Delivery', s: 'Across India' },
                  { icon: FiShield, t: '100% Authentic', s: 'Brand assured' },
                  { icon: FiRefreshCw, t: 'Easy Returns', s: '7-day policy' },
                ].map((b) => (
                  <div key={b.t} className="flex flex-col items-center text-center gap-1 bg-white rounded-2xl border border-gray-100 shadow-sm py-4 px-2">
                    <b.icon className="text-secondary-500" size={22} />
                    <div className="text-xs font-semibold text-ink-900">{b.t}</div>
                    <div className="text-[11px] text-gray-400">{b.s}</div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        {/* Description + Specifications */}
        <div className="grid lg:grid-cols-2 gap-8 mt-12">
          <Reveal className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold text-ink-900 mb-4">Product Description</h2>
            {product.description ? (
              <p className="text-gray-600 leading-relaxed whitespace-pre-line">{product.description}</p>
            ) : (
              <p className="text-gray-600 leading-relaxed">
                The <span className="font-medium text-ink-900">{product.name}</span> from {product.brand} is a
                dependable choice for {category?.label.toLowerCase()}. Trusted by hospitals, clinics and
                households across India, it combines clinical-grade accuracy with everyday ease of use —
                backed by Dia Shoppe’s promise of 100% authentic products since 2004.
              </p>
            )}
            <ul className="mt-5 space-y-2.5">
              {featuresFor(product, category?.label || 'medical').map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <FiCheck className="text-secondary-500 mt-0.5 shrink-0" size={16} /> {f}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal className="relative overflow-hidden rounded-3xl shadow-sm p-6 sm:p-8 text-white bg-gradient-to-b from-ink-950 via-primary-950 to-ink-950">
            <div className="absolute -top-10 -right-10 w-56 h-56 bg-secondary-500/20 rounded-full blur-3xl animate-blob-slow" aria-hidden="true" />
            <div className="relative">
              <h2 className="font-display text-2xl font-semibold text-white mb-4">Specifications</h2>
              <dl className="divide-y divide-white/10">
                {specs.map((s) => (
                  <div key={s.k} className="flex justify-between gap-4 py-3">
                    <dt className="text-sm text-blue-100/70 shrink-0">{s.k}</dt>
                    <dd className="text-sm font-medium text-white text-right">{s.v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
        </div>

        {/* Related products */}
        {related.length > 0 && (
          <section className="mt-16">
            <Reveal className="flex items-end justify-between mb-6">
              <h2 className="font-display text-2xl sm:text-3xl font-semibold text-ink-900">You may also like</h2>
              <Link to={`/products?category=${product.category}`} className="flex items-center gap-1 text-primary-700 font-semibold text-sm hover:underline">
                View all <FiChevronRight size={16} />
              </Link>
            </Reveal>
            <Stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {related.map((p) => (
                <StaggerItem key={p.id}><ProductCard product={p} /></StaggerItem>
              ))}
            </Stagger>
          </section>
        )}
      </div>

      <Footer />
    </div>
  )
}
