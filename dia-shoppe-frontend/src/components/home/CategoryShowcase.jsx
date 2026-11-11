import { useCallback, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import CircularCarousel from '../ui/CircularCarousel'
import { LiquidButton } from '../ui/buttons'
import DsPair from './DsPair'
import { useReveal } from '../../lib/useReveal'
import { useNarrow } from '../../lib/useNarrow'
import { scrollToEl } from '../../lib/smoothScroll'

/*
  Shop by Category — CircularCarousel of the real categories. Choosing one
  (click / tap / Enter, or the pills underneath) opens a secondary panel with
  that category's details, a Shop Now action and its products in a freshly
  shuffled ring. With fewer than four products the panel shows plain product
  cards instead of a ring (a ring of one or two looks wrong, and we never pad
  with invented or duplicated products). The glass D + S sit behind it as one static, compact pair.
*/
const shuffle = (list) => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const plateFor = (p) => p.image || `/categories/${p.category}.jpg`   // real photo, else the category photo

/* Compact, palette-matched product card for categories with fewer than four products. */
function MiniProduct({ p }) {
  const inStock = p.stock > 0
  return (
    <Link
      to={`/products/${p.slug}`}
      className="group flex gap-4 rounded-2xl border border-dia-cyan/15 bg-white p-3 outline-none transition-shadow hover:shadow-[0_20px_40px_-20px_rgba(2,18,37,0.35)] focus-visible:ring-[3px] focus-visible:ring-dia-aqua/60"
    >
      <img src={plateFor(p)} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-xl object-cover" />
      <div className="min-w-0 self-center">
        <div className="dia-label">{p.brand}</div>
        <div className="mt-1 line-clamp-2 font-heading text-base font-bold leading-snug text-dia-ink group-hover:text-dia-cyan">{p.name}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-heading font-extrabold text-dia-ink">₹{p.price.toLocaleString('en-IN')}</span>
          {p.originalPrice > p.price && <span className="text-xs text-dia-ink/45 line-through">₹{p.originalPrice.toLocaleString('en-IN')}</span>}
        </div>
        <div className="text-xs text-dia-ink/55">{inStock ? 'In stock' : 'Currently unavailable'}</div>
      </div>
    </Link>
  )
}

function CategoryPanel({ cat, products, onClose, panelRef }) {
  const navigate = useNavigate()
  const narrow = useNarrow()
  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))].slice(0, 5)
  const ring = products.length >= 4
  const items = products.map((p) => ({
    src: plateFor(p), alt: p.name, title: p.name, subtitle: `₹${p.price.toLocaleString('en-IN')}`, slug: p.slug,
  }))
  const Icon = cat.icon

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: 36 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mt-10 overflow-hidden rounded-[28px] border border-dia-cyan/15 bg-white/70 p-6 shadow-[0_40px_80px_-40px_rgba(2,18,37,0.35)] backdrop-blur-xl sm:p-10"
      aria-live="polite"
    >
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <span className="dia-label inline-flex items-center gap-2">
            {Icon && <Icon size={14} aria-hidden="true" />} Category
          </span>
          <h3 className="font-heading text-3xl font-extrabold leading-tight text-dia-ink sm:text-4xl">{cat.label}</h3>
          <p className="text-base leading-relaxed text-dia-ink/70">{cat.desc}</p>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="dia-label">Products</dt>
              <dd className="mt-1 font-heading text-2xl font-bold text-dia-ink">{products.length}</dd>
            </div>
            {brands.length > 0 && (
              <div className="min-w-0">
                <dt className="dia-label">Brands</dt>
                <dd className="mt-1 text-dia-ink/80">{brands.join(' · ')}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <LiquidButton as={Link} to={`/products?category=${cat.slug}`} variant="accent" size="lg">
              Shop Now
            </LiquidButton>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-5 py-3 text-sm font-semibold text-dia-cyan underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-dia-aqua/60"
            >
              Back to categories
            </button>
          </div>
        </div>

        <div className="min-w-0">
          {products.length === 0 && (
            <p className="rounded-2xl bg-dia-mint p-8 text-center text-dia-ink/70">
              Products for this category are on their way. Use Shop Now to see everything we stock.
            </p>
          )}
          {products.length > 0 && !ring && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {products.map((p) => <MiniProduct key={p.id} p={p} />)}
            </div>
          )}
          {ring && (
            <div className="h-[340px] text-dia-ink sm:h-[400px]">
              <CircularCarousel
                items={items}
                preset="orbit"
                intro="assemble"
                cardWidth={narrow ? 140 : 180}
                aspectRatio={1}
                speed={10}
                captions
                cornerRadius={16}
                depthFade={0.45}
                ariaLabel={`${cat.label} products`}
                onItemClick={(item) => navigate(`/products/${item.slug}`)}
              />
            </div>
          )}
          {ring && <p className="mt-2 text-center text-xs text-dia-ink/55">Drag to explore. Click a product to open it.</p>}
        </div>
      </div>
    </motion.div>
  )
}

export default function CategoryShowcase({ categories, products }) {
  const rootRef = useRef(null)
  const panelRef = useRef(null)
  const phone = useNarrow(640)
  const tablet = useNarrow(1024)
  const [selected, setSelected] = useState(null)   // { slug, products }
  const [active, setActive] = useState(0)
  useReveal(rootRef)

  const select = useCallback((slug) => {
    setSelected({ slug, products: shuffle(products.filter((p) => p.category === slug)) })
    // wait for the panel to mount, then bring it into view
    setTimeout(() => scrollToEl(panelRef.current, -100), 120)
  }, [products])

  const items = categories.map((c) => ({
    src: `/categories/${c.slug}.jpg`, alt: c.label, title: c.label, subtitle: c.desc, slug: c.slug,
  }))
  const focused = categories[active] || categories[0]
  const current = selected && categories.find((c) => c.slug === selected.slug)
  const count = (slug) => products.filter((p) => p.category === slug).length

  return (
    <section ref={rootRef} id="categories" className="relative overflow-hidden py-20 sm:py-24">
      {/* the glass D + S: together, huge, centred behind the carousel, and
          completely still. Centred with margins (not a transform) so the glass
          blends with the page background behind it. */}
      <DsPair
        className="absolute left-[-12vw] top-[330px] w-[124vw] sm:inset-x-0 sm:left-auto sm:top-[250px] sm:mx-auto sm:w-[92vw] lg:top-[235px] lg:w-[min(76vw,1060px)]"
        opacity={phone ? 0.45 : 0.6}
      />
      <div className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div data-reveal className="mx-auto mb-4 max-w-2xl text-center">
          <span className="dia-label inline-block rounded-full border border-dia-cyan/25 bg-white/70 px-3 py-1 backdrop-blur">Categories</span>
          <h2 className="mt-4 font-heading text-4xl font-extrabold text-dia-ink sm:text-5xl">Shop by Category</h2>
          <p className="mt-3 text-lg text-dia-ink/65">Find exactly what you need from our wide range. Pick a category to see what is inside.</p>
        </div>

        {/* large ring: the front card dominates, neighbours stay visible on both sides */}
        <div data-reveal data-reveal-delay="0.1" className="h-[440px] text-dia-ink sm:h-[600px] lg:h-[760px]">
          <CircularCarousel
            items={items}
            preset="cylinder"
            intro="rise"
            cardWidth={phone ? 220 : tablet ? 320 : 430}
            aspectRatio={0.82}
            gap={phone ? 18 : 28}
            perspective={phone ? 1100 : 1700}
            speed={12}
            cornerRadius={22}
            depthFade={0.55}
            innerShade={0.5}
            ariaLabel="Product categories"
            onChange={setActive}
            onItemClick={(item) => select(item.slug)}
          />
        </div>

        {/* caption for the card in front, large and actionable */}
        {focused && (
          <div className="mx-auto -mt-2 flex max-w-xl flex-col items-center gap-3 text-center" aria-live="polite">
            <div key={focused.slug} className="animate-fade-up">
              <h3 className="font-heading text-2xl font-extrabold text-dia-ink sm:text-3xl">{focused.label}</h3>
              <p className="mt-1 text-dia-ink/65">{focused.desc}</p>
            </div>
            <LiquidButton type="button" size="sm" variant="accent" onClick={() => select(focused.slug)}>
              Explore {focused.label}{count(focused.slug) ? ` · ${count(focused.slug)}` : ''}
            </LiquidButton>
          </div>
        )}

        <div data-reveal className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2" role="group" aria-label="Choose a category">
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              aria-pressed={selected?.slug === c.slug}
              onClick={() => select(c.slug)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-dia-aqua/60 ${
                selected?.slug === c.slug
                  ? 'border-dia-cyan bg-dia-cyan text-white'
                  : 'border-dia-cyan/25 bg-white/70 text-dia-ink hover:bg-dia-tea'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {current && (
            <CategoryPanel
              key={selected.slug}
              cat={current}
              products={selected.products}
              panelRef={panelRef}
              onClose={() => { setSelected(null); scrollToEl(rootRef.current, 0) }}
            />
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
