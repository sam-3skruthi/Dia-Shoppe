import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DepthCarousel from '../ui/DepthCarousel'
import { LiquidButton } from '../ui/buttons'
import { useCart } from '../../context/CartContext'
import { useReveal } from '../../lib/useReveal'
import { useNarrow } from '../../lib/useNarrow'
import { FiChevronRight } from 'react-icons/fi'

/*
  Featured Products — DepthCarousel over the same six products the old grid
  showed (first six of the live catalog). The focused card opens its product
  page; the panel under the carousel shows its details and the existing
  add-to-cart. A product without a photo falls back to its category photo.
*/
export default function FeaturedDepth({ products }) {
  const rootRef = useRef(null)
  const navigate = useNavigate()
  const narrow = useNarrow()
  const { addItem } = useCart()
  const [active, setActive] = useState(0)
  const [added, setAdded] = useState(false)
  useReveal(rootRef)

  const featured = products.slice(0, 6)
  const items = featured.map((p) => ({ image: p.image || `/categories/${p.category}.jpg`, alt: p.name }))
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
    <section ref={rootRef} className="relative overflow-hidden bg-white py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-dia-mint to-transparent" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="dia-label inline-block rounded-full border border-dia-cyan/25 bg-dia-tea/60 px-3 py-1">Top Picks</span>
            <h2 className="mt-4 font-heading text-4xl font-extrabold text-dia-ink sm:text-5xl">Featured Products</h2>
          </div>
          <LiquidButton as={Link} to="/products" size="sm">
            View All <FiChevronRight size={16} aria-hidden="true" />
          </LiquidButton>
        </div>

        {featured.length > 0 ? (
          <>
            <div data-reveal className="h-[430px] sm:h-[500px]">
              <DepthCarousel
                items={items}
                cardWidth={narrow ? 210 : 290}
                cardHeight={narrow ? 280 : 380}
                depth={narrow ? 150 : 220}
                spread={narrow ? 56 : 90}
                tilt={22}
                tiltDirection="right"
                perspective={1400}
                visibleCards={narrow ? 3 : 4}
                falloff={0.2}
                blur={6}
                autoplay
                autoplayDelay={4200}
                loop
                ariaLabel="Featured products"
                onChange={(i) => { setActive(i); setAdded(false) }}
                onItemClick={(i) => navigate(`/products/${featured[i].slug}`)}
              />
            </div>

            {current && (
              <div
                data-reveal
                aria-live="polite"
                className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-between gap-5 rounded-3xl border border-dia-cyan/15 bg-dia-mint/70 p-5 sm:p-6"
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
          </>
        ) : (
          <p className="rounded-2xl bg-dia-mint p-10 text-center text-dia-ink/60">Loading our featured products…</p>
        )}
      </div>
    </section>
  )
}
