import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { motion } from './motion'
import { useCatalog } from '../context/CatalogContext'
import { getCategory } from '../data/products'
import { dailyDeals, discountOf } from '../lib/deals'
import { FiZap, FiClock, FiArrowRight, FiTag } from 'react-icons/fi'

/*
  Right-side spotlight for the Products page header band.
  Shows a small "book" of pages that flip one after another:
    · Deal of the Day — 3 products per day (one page each, rotates daily)
    · Live Sale page with countdown (when a sale event is running)
    · "Sale coming soon" page (when no sale is running)
  Pages auto-flip every few seconds with a 3D page-turn.
*/

const pad = (n) => String(n).padStart(2, '0')
const FLIP_MS = 4200

function useCountdown(endsAt) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(endsAt) - Date.now()))
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, new Date(endsAt) - Date.now())), 1000)
    return () => clearInterval(id)
  }, [endsAt])
  const s = Math.floor(left / 1000)
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
  }
}

function CountdownBox({ value, label }) {
  return (
    <div className="bg-white/10 border border-white/15 rounded-lg px-2 py-1.5 text-center min-w-[44px]">
      <div className="font-bold text-white text-lg leading-none tabular-nums">{pad(value)}</div>
      <div className="text-[10px] text-dia-mint/60 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  )
}

function SalePage({ event, products, onShopSale }) {
  const t = useCountdown(event.ends_at)
  const maxOff = Math.max(0, ...products.filter((p) => p.onSale).map(discountOf))

  return (
    <div className="relative">
      <div className="absolute -top-8 -right-8 w-40 h-40 bg-secondary-500/25 rounded-full blur-2xl" aria-hidden="true" />
      <div className="relative">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-950 bg-secondary-400 rounded-full px-2.5 py-1">
          <FiZap size={12} /> Live Sale
        </span>
        <h3 className="font-display text-2xl text-white mt-3 leading-tight">{event.name}</h3>
        {maxOff > 0 && <p className="text-secondary-300 font-semibold mt-1">Up to {maxOff}% off</p>}
        <div className="flex items-center gap-2 mt-4">
          <FiClock size={14} className="text-dia-mint/60 shrink-0" />
          {t.days > 0 && <CountdownBox value={t.days} label="days" />}
          <CountdownBox value={t.hours} label="hrs" />
          <CountdownBox value={t.mins} label="min" />
          <CountdownBox value={t.secs} label="sec" />
        </div>
        <button
          onClick={onShopSale}
          className="mt-4 inline-flex items-center gap-1.5 bg-secondary-500 hover:bg-secondary-400 text-ink-950 font-semibold text-sm px-4 py-2 rounded-full transition-colors"
        >
          Shop the sale <FiArrowRight size={15} />
        </button>
      </div>
    </div>
  )
}

function DealPage({ deal, index, total }) {
  const off = discountOf(deal)
  const Icon = getCategory(deal.category)?.icon

  return (
    <div className="relative">
      <div className="absolute -bottom-8 -left-8 w-36 h-36 bg-secondary-500/20 rounded-full blur-2xl" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-secondary-200 bg-white/10 border border-white/15 rounded-full px-2.5 py-1">
            <FiTag size={12} /> Deal of the Day
          </span>
          <span className="text-[11px] text-dia-mint/50 tabular-nums">{index + 1} / {total}</span>
        </div>
        <Link to={`/products/${deal.slug}`} className="group flex items-center gap-4 mt-3">
          <span className="w-16 h-16 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0">
            {deal.image
              ? <img src={deal.image} alt="" className="w-full h-full object-cover" />
              : Icon && <Icon size={26} className="text-secondary-500" />}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-white text-sm leading-snug line-clamp-2 group-hover:text-secondary-200 transition-colors">
              {deal.name}
            </span>
            <span className="flex items-baseline gap-2 mt-1 flex-wrap">
              <span className="text-lg font-bold text-secondary-300">₹{deal.price.toLocaleString('en-IN')}</span>
              <span className="text-xs text-dia-mint/50 line-through">₹{deal.originalPrice.toLocaleString('en-IN')}</span>
              {off > 0 && <span className="text-[11px] font-bold text-ink-950 bg-secondary-400 rounded-full px-1.5 py-0.5">{off}% OFF</span>}
            </span>
          </span>
        </Link>
        <Link
          to={`/products/${deal.slug}`}
          className="mt-4 inline-flex items-center gap-1.5 text-secondary-200 hover:text-white font-semibold text-sm transition-colors"
        >
          Grab it today <FiArrowRight size={15} />
        </Link>
      </div>
    </div>
  )
}

function ComingSoonPage() {
  return (
    <div className="relative text-center py-2">
      <div className="absolute -top-8 -right-8 w-36 h-36 bg-secondary-500/20 rounded-full blur-2xl" aria-hidden="true" />
      <div className="relative">
        <span className="inline-flex w-12 h-12 rounded-full bg-white/10 border border-white/15 items-center justify-center text-secondary-300 mx-auto">
          <FiZap size={22} />
        </span>
        <h3 className="font-display text-xl text-white mt-3">Sale coming soon</h3>
        <p className="text-sm text-dia-mint/60 mt-1">Seasonal offers on trusted equipment are on the way. Check back shortly.</p>
      </div>
    </div>
  )
}

export default function SaleSpotlight({ onShopSale }) {
  const { products, saleEvent } = useCatalog()
  const [page, setPage] = useState(0)

  const deals = useMemo(() => dailyDeals(products, 3), [products])

  // pages of the "book": live sale first when running, else deals then coming-soon
  const pages = useMemo(() => {
    const dealPages = deals.map((d, i) => ({
      key: `deal-${d.id}`,
      node: <DealPage deal={d} index={i} total={deals.length} />,
    }))
    if (saleEvent) {
      return [
        { key: 'sale', node: <SalePage event={saleEvent} products={products} onShopSale={onShopSale} /> },
        ...dealPages,
      ]
    }
    return [...dealPages, { key: 'soon', node: <ComingSoonPage /> }]
  }, [deals, saleEvent, products, onShopSale])

  useEffect(() => {
    if (pages.length <= 1) return
    const id = setInterval(() => setPage((p) => (p + 1) % pages.length), FLIP_MS)
    return () => clearInterval(id)
  }, [pages.length])

  if (pages.length === 0) return null
  const current = pages[page % pages.length]

  return (
    <div style={{ perspective: 1200 }}>
      <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm p-5 min-h-[212px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.key}
            initial={{ rotateY: -85, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: 85, opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformStyle: 'preserve-3d', transformOrigin: 'left center' }}
          >
            {current.node}
          </motion.div>
        </AnimatePresence>

        {/* page dots */}
        {pages.length > 1 && (
          <div className="absolute bottom-3 right-4 flex gap-1.5">
            {pages.map((p, i) => (
              <button
                key={p.key}
                onClick={() => setPage(i)}
                aria-label={`Page ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === page % pages.length ? 'w-5 bg-secondary-400' : 'w-1.5 bg-white/25 hover:bg-white/40'}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
