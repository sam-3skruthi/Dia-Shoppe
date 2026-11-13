import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useCatalog } from '../context/CatalogContext'
import { getCategory } from '../data/products'
import { discountOf } from '../lib/deals'
import { FiTag } from 'react-icons/fi'

/*
  Sale-frontend piece #3 — a slim strip for the Cart page, shown between the
  "My Cart" heading and the item list while the sale design is on. A little
  "SALE" ribbon on the left, and the sale products cycling through one by one
  on the right. Falls back to discounted products when no live sale event is
  overlaying prices (e.g. in preview/forced mode).
*/

const ROTATE_MS = 2500

export default function CartSaleStrip() {
  const { products, saleMode } = useCatalog()

  const saleProducts = useMemo(() => {
    const onSale = products.filter((p) => p.onSale)
    if (onSale.length) return onSale
    return products.filter((p) => discountOf(p) > 0 && p.stock > 0)
  }, [products])

  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (saleProducts.length <= 1) return
    const id = setInterval(() => setIdx((i) => (i + 1) % saleProducts.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [saleProducts.length])

  if (!saleMode || saleProducts.length === 0) return null
  const p = saleProducts[idx % saleProducts.length]
  const off = discountOf(p)
  const Icon = getCategory(p.category)?.icon

  return (
    <div className="mb-5 flex items-stretch overflow-hidden rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm">
      {/* SALE ribbon */}
      <div className="flex shrink-0 items-center gap-2 bg-[color:var(--sale-accent,#0277BD)] px-4 sm:px-5">
        <FiTag size={15} className="text-white" />
        <span className="font-display text-lg font-bold uppercase tracking-[0.18em] text-white">Sale</span>
      </div>

      {/* rotating sale product */}
      <div className="relative min-w-0 flex-1 px-4 py-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={p.id}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <Link to={`/products/${p.slug}`} className="group flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
                {p.image
                  ? <img src={p.image} alt="" className="h-full w-full object-cover" />
                  : Icon && <Icon size={20} className="text-secondary-500" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white group-hover:text-secondary-200 transition-colors">
                  {p.name}
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="font-bold text-secondary-300">₹{p.price.toLocaleString('en-IN')}</span>
                  <span className="text-xs text-dia-mint/50 line-through">₹{p.originalPrice.toLocaleString('en-IN')}</span>
                  {off > 0 && (
                    <span className="rounded-full bg-secondary-400 px-1.5 py-0.5 text-[10px] font-bold text-ink-950">{off}% OFF</span>
                  )}
                </span>
              </span>
            </Link>
          </motion.div>
        </AnimatePresence>

        {/* progress dots */}
        {saleProducts.length > 1 && (
          <div className="absolute bottom-1.5 right-3 flex gap-1">
            {saleProducts.slice(0, 6).map((sp, i) => (
              <span key={sp.id} className={`h-1 rounded-full transition-all ${i === idx % Math.min(saleProducts.length, 6) ? 'w-3 bg-secondary-400' : 'w-1 bg-white/25'}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
