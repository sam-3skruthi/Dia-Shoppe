import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCatalog } from '../context/CatalogContext'
import { getCategory } from '../data/products'
import { dailyDeals, discountOf } from '../lib/deals'
import { FiZap, FiTag, FiArrowRight, FiClock } from 'react-icons/fi'

/*
  Horizontal auto-scrolling strip of deal cards — same continuous marquee
  motion as the brand-logo strip on the landing page. Shows today's 3 deals
  plus a Live Sale card (with time left) or a "Sale coming soon" card.
  Used on the Cart page below the cart contents.
*/

const timeLeft = (endsAt) => {
  const s = Math.max(0, Math.floor((new Date(endsAt) - Date.now()) / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`
}

function DealCard({ deal }) {
  const off = discountOf(deal)
  const Icon = getCategory(deal.category)?.icon
  return (
    <Link
      to={`/products/${deal.slug}`}
      className="group w-72 shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3 hover:shadow-lg hover:border-secondary-200 transition-all"
    >
      <span className="w-14 h-14 rounded-xl bg-secondary-50 flex items-center justify-center overflow-hidden shrink-0">
        {deal.image
          ? <img src={deal.image} alt="" className="w-full h-full object-cover" />
          : Icon && <Icon size={24} className="text-secondary-500" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-secondary-600">
          <FiTag size={10} /> Deal of the Day
        </span>
        <span className="block font-semibold text-ink-900 text-sm leading-snug truncate group-hover:text-primary-700 transition-colors">
          {deal.name}
        </span>
        <span className="flex items-baseline gap-1.5 mt-0.5">
          <span className="font-bold text-primary-700">₹{deal.price.toLocaleString('en-IN')}</span>
          <span className="text-xs text-gray-400 line-through">₹{deal.originalPrice.toLocaleString('en-IN')}</span>
          {off > 0 && <span className="text-[10px] font-bold text-white bg-secondary-500 rounded-full px-1.5 py-0.5">{off}% OFF</span>}
        </span>
      </span>
    </Link>
  )
}

function SaleLiveCard({ event }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 30000) // refresh "time left" every 30s
    return () => clearInterval(id)
  }, [])
  return (
    <Link
      to="/products"
      className="group w-72 shrink-0 rounded-2xl p-4 flex items-center gap-3 bg-gradient-to-br from-ink-950 via-primary-950 to-ink-950 border border-secondary-400/30 shadow-sm hover:shadow-lg transition-all"
    >
      <span className="w-14 h-14 rounded-xl bg-secondary-500 flex items-center justify-center shrink-0">
        <FiZap size={24} className="text-ink-950" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-secondary-300">Live Sale</span>
        <span className="block font-semibold text-white text-sm leading-snug truncate">{event.name}</span>
        <span className="flex items-center gap-1 text-xs text-blue-100/70 mt-0.5">
          <FiClock size={11} /> {timeLeft(event.ends_at)} <FiArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
        </span>
      </span>
    </Link>
  )
}

function SaleSoonCard() {
  return (
    <div className="w-72 shrink-0 rounded-2xl p-4 flex items-center gap-3 bg-white/5 border border-white/15 backdrop-blur-sm">
      <span className="w-14 h-14 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
        <FiZap size={24} className="text-secondary-300" />
      </span>
      <span>
        <span className="block text-[10px] font-bold uppercase tracking-wider text-secondary-300">Coming Soon</span>
        <span className="block font-semibold text-white text-sm">New sale event on the way</span>
        <span className="block text-xs text-blue-100/60 mt-0.5">Seasonal offers — stay tuned</span>
      </span>
    </div>
  )
}

export default function DealsMarquee() {
  const { products, saleEvent } = useCatalog()
  const deals = useMemo(() => dailyDeals(products, 3), [products])

  const cards = useMemo(() => {
    const list = deals.map((d) => ({ key: `deal-${d.id}`, node: <DealCard deal={d} /> }))
    if (saleEvent) list.unshift({ key: 'sale', node: <SaleLiveCard event={saleEvent} /> })
    else list.push({ key: 'soon', node: <SaleSoonCard /> })
    return list
  }, [deals, saleEvent])

  if (cards.length === 0) return null
  // repeat enough times for a seamless -50% loop regardless of card count
  const loop = [...cards, ...cards, ...cards, ...cards]

  return (
    <section className="relative py-10" aria-label="Today's deals">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-4">
        <h2 className="font-display text-xl font-semibold text-white">Today's Picks</h2>
        <p className="text-sm text-blue-100/60">Deals refresh daily — grab them while they last</p>
      </div>
      <div className="overflow-hidden">
        <div className="flex w-max items-stretch gap-4 px-4 animate-marquee hover:[animation-play-state:paused]">
          {loop.map((c, i) => (
            <div key={`${c.key}-${i}`}>{c.node}</div>
          ))}
        </div>
      </div>
    </section>
  )
}
