import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchActiveSale } from '../lib/sale'
import { fetchSaleThemeForced } from '../lib/settings'

/*
  Live product catalog from Supabase. Fetched once on app load and shared —
  replaces the hardcoded list in data/products.js for the storefront pages.
  Rows are mapped to the shape the components already use (category = slug,
  stock, originalPrice), so ProductCard etc. need no changes. The category
  taxonomy (labels + icons) stays static in data/products.js.

  Also overlays the currently-active sale event (if any, see lib/sale.js):
  a sale product's `price` becomes the sale price and `originalPrice` becomes
  its regular price, so the existing strikethrough UI shows the sale discount
  automatically. No admin/product data is changed — this is purely a display
  overlay that starts/stops itself with the sale's date window.
*/
const CatalogContext = createContext(null)

const mapProduct = (row) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  brand: row.brand,
  category: row.categories?.slug || null,
  price: Number(row.price),
  originalPrice: row.original_price != null ? Number(row.original_price) : Number(row.price),
  badge: row.badge,
  stock: row.stock_qty,
  rating: row.rating ?? 4,
  image: row.image_url,
  description: row.description,
  // per-product spec rows [{ k, v }] from the admin specs editor (jsonb column)
  specs: Array.isArray(row.specs) ? row.specs.filter((s) => s && s.k && s.v) : null,
  onSale: false,
})

export function CatalogProvider({ children }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saleEvent, setSaleEvent] = useState(null)
  const [forcedSaleTheme, setForcedSaleTheme] = useState(false)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      supabase.from('products').select('*, categories(slug)').eq('is_active', true).order('id'),
      fetchActiveSale(),
      fetchSaleThemeForced(),
    ]).then(([{ data, error: err }, { event, prices }, forced]) => {
      if (cancelled) return
      if (err) {
        setError(err.message)
      } else {
        const mapped = (data || []).map(mapProduct).map((p) => {
          const salePrice = prices.get(p.id)
          if (salePrice == null) return p
          return { ...p, price: salePrice, originalPrice: p.price, badge: 'SALE', onSale: true }
        })
        setProducts(mapped)
        setSaleEvent(event)
        setForcedSaleTheme(forced)
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  // Sale design is ON when a sale event is live, an admin forced it, or the
  // session was opened with ?preview_sale=1 (a way to preview the sale look
  // without a live sale — affects the DESIGN only, never real prices).
  // Persisted to sessionStorage so it survives in-app navigation; add
  // ?preview_sale=0 to turn the preview back off.
  const previewSale = (() => {
    if (typeof window === 'undefined') return false
    const p = new URLSearchParams(window.location.search).get('preview_sale')
    if (p === '1') sessionStorage.setItem('preview_sale', '1')
    if (p === '0') sessionStorage.removeItem('preview_sale')
    return sessionStorage.getItem('preview_sale') === '1'
  })()
  const saleMode = !!saleEvent || forcedSaleTheme || previewSale

  // Expose the mode to CSS/design via a root attribute so the "sale frontend"
  // can be styled purely with [data-sale-theme="on"] selectors.
  useEffect(() => {
    document.documentElement.setAttribute('data-sale-theme', saleMode ? 'on' : 'off')
  }, [saleMode])

  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort()
  const getProductBySlug = (slug) => products.find((p) => p.slug === slug)

  return (
    <CatalogContext.Provider value={{ products, brands, loading, error, getProductBySlug, saleEvent, saleMode, forcedSaleTheme }}>
      {children}
    </CatalogContext.Provider>
  )
}

export const useCatalog = () => {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog must be used within a CatalogProvider')
  return ctx
}
