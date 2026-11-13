import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import CircularGallery from '../bits/CircularGallery'
import Magnet from '../bits/Magnet'
import { LiquidButton } from '../ui/buttons'
import { useCart } from '../../context/CartContext'
import { useReveal } from '../../lib/useReveal'
import { useNarrow } from '../../lib/useNarrow'
import { FiChevronRight } from 'react-icons/fi'

/*
  Featured Products — a CircularGallery (WebGL arc of cards) over the first
  twelve products of the live catalog. The centred card drives the details
  panel underneath (price, stock, the existing add-to-cart); clicking a card
  opens its product page. A product without a photo falls back to its
  category photo. The section is marked data-hide-ds so the site-wide glass
  D + S never show here: the ghost fibres stay, the focus stays on products.
*/
export default function FeaturedDepth({ products }) {
  const rootRef = useRef(null)
  const navigate = useNavigate()
  const narrow = useNarrow()
  const { addItem } = useCart()
  const [active, setActive] = useState(0)
  const [added, setAdded] = useState(false)
  useReveal(rootRef)

  const featured = products.slice(0, 12)
  const items = featured.map((p) => ({
    image: p.image || `/categories/${p.category}.jpg`,
    text: p.name,
    description: `₹${p.price.toLocaleString('en-IN')}`,
    alt: p.name,
  }))
  const current = featured[active] || featured[0]
  const inStock = current ? current.stock > 0 : false
  const discount = current && current.originalPrice > current.price
    ? Math.round(((current.originalPrice - current.price) / current.originalPrice) * 100) : 0

  const add = () => {
    if (!current) return
    addItem(current)
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  return (
    <section ref={rootRef} id="featured" data-hide-ds className="relative overflow-hidden py-20 sm:py-28">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="dia-label dia-glass inline-block rounded-full px-3.5 py-1.5">Top Picks</span>
            <h2 className="mt-4 font-heading text-4xl font-extrabold text-dia-ink sm:text-5xl">Featured Products</h2>
          </div>
          <Magnet padding={60} magnetStrength={3} maxOffset={12}>
            <LiquidButton as={Link} to="/products" size="sm">
              View All <FiChevronRight size={16} aria-hidden="true" />
            </LiquidButton>
          </Magnet>
        </div>

        {featured.length > 0 ? (
          <>
            {/* ONE opaque palette stage holding both the carousel and the
                product details: a clean, solid surface (no fibres or page
                showing through) so the product cards pop */}
            <div
              data-reveal
              className="relative overflow-hidden rounded-[32px] bg-[linear-gradient(180deg,#E0F7FA_0%,#CAF0F8_50%,#90E0EF_100%)] pb-6 shadow-[0_40px_90px_-45px_rgba(2,119,189,0.55),inset_0_1px_0_rgba(224,247,250,0.9)] ring-1 ring-dia-cyan/15 sm:pb-8"
            >
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[radial-gradient(60%_80%_at_50%_100%,rgba(0,180,216,0.28),transparent_70%)]" />
              <div className="relative h-[400px] sm:h-[480px]">
              <CircularGallery
                items={items}
                bend={narrow ? 2 : 2.6}
                itemSize={narrow ? 0.62 : 0.7}
                itemAspect={0.8}
                gap={0.34}
                borderRadius={0.06}
                wave={0.6}
                fadeEdges={0.1}
                shadow={0.3}
                textColor="#021225"
                font="700 17px Manrope"
                scrollSpeed={2}
                scrollEase={0.06}
                autoScroll={0.6}
                openOnClick={false}
                onActiveChange={(i) => { setActive(i); setAdded(false) }}
                onItemClick={(_, i) => navigate(`/products/${featured[i].slug}`)}
                aria-label="Featured products"
              />
              </div>

            {current && (
              <div
                aria-live="polite"
                className="dia-glass relative mx-4 flex flex-wrap items-center justify-between gap-5 rounded-3xl p-5 sm:mx-auto sm:max-w-3xl sm:p-6"
              >
                <div className="min-w-0">
                  <div className="dia-label">{current.brand}</div>
                  <Link
                    to={`/products/${current.slug}`}
                    className="mt-1 block font-heading text-xl font-bold leading-snug text-dia-ink outline-none hover:text-dia-cyan focus-visible:ring-[3px] focus-visible:ring-dia-aqua/60"
                  >
                    {current.name}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-heading text-2xl font-extrabold text-dia-ink">₹{current.price.toLocaleString('en-IN')}</span>
                    {current.originalPrice > current.price && (
                      <span className="text-sm text-dia-ink/45 line-through">₹{current.originalPrice.toLocaleString('en-IN')}</span>
                    )}
                    {discount > 0 && <span className="text-sm font-semibold text-dia-cyan">{discount}% off</span>}
                  </div>
                  <div className="mt-1 text-sm text-dia-ink/60">
                    {inStock ? (current.stock <= 5 ? `Only ${current.stock} left` : 'In stock') : 'Currently unavailable'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <LiquidButton as={Link} to={`/products/${current.slug}`} size="lg">View product</LiquidButton>
                  <button
                    type="button"
                    onClick={add}
                    disabled={!inStock}
                    className="h-12 rounded-full bg-dia-ink px-7 text-[15px] font-semibold text-dia-mint outline-none transition-colors hover:bg-dia-cyan focus-visible:ring-[3px] focus-visible:ring-dia-aqua/70 disabled:cursor-not-allowed disabled:bg-dia-ink/20 disabled:text-dia-ink/40"
                  >
                    {!inStock ? 'Out of Stock' : added ? 'Added ✓' : 'Add to Cart'}
                  </button>
                </div>
              </div>
            )}
            </div>
          </>
        ) : (
          <p className="rounded-2xl bg-dia-mint p-10 text-center text-dia-ink/60">Loading our featured products…</p>
        )}
      </div>
    </section>
  )
}
