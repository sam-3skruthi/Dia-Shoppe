import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { track } from '../lib/analytics'
import { useAuth } from './AuthContext'
import { fetchDbCart, replaceDbCart } from '../lib/cartSync'

/*
  Global cart state — shared by Header (badge), ProductCard / ProductDetail
  (Add to Cart) and the Cart page. Persisted to localStorage so a refresh keeps
  the basket. Stores a slim snapshot of each product (the fields the cart needs)
  so it stays decoupled from the full catalog shape.

  Logged-in customers also get the cart synced to cart_items in the database
  (see lib/cartSync.js) so it follows them to a new device — guests stay
  localStorage-only. On login, the guest cart merges into the account's
  saved cart (quantities combine, capped at stock); after that, every change
  is pushed to the database in the background (debounced).
*/
const CartContext = createContext(null)
const STORAGE_KEY = 'diashoppe_cart'
const SYNC_DEBOUNCE_MS = 800

const slim = (p) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  brand: p.brand,
  category: p.category,
  price: p.price,
  originalPrice: p.originalPrice,
  stock: p.stock,
})

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  const { user, loading: authLoading } = useAuth()
  // which user's DB cart the local `items` currently reflect — guards the
  // merge-on-login from re-running on every render, and skips syncing back
  // the DB's own data as if it were a local change
  const mergedForUserId = useRef(null)

  // merge on login: guest cart (if any) + this account's saved cart
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      mergedForUserId.current = null
      return
    }
    if (mergedForUserId.current === user.id) return
    mergedForUserId.current = user.id

    let cancelled = false
    fetchDbCart(user.id).then(({ items: dbItems }) => {
      if (cancelled) return
      setItems((localItems) => {
        const merged = [...dbItems]
        for (const local of localItems) {
          const cap = local.stock || 99
          const existing = merged.find((i) => i.id === local.id)
          if (existing) existing.qty = Math.min(existing.qty + local.qty, cap)
          else merged.push(local)
        }
        replaceDbCart(user.id, merged)
        return merged
      })
    })
    return () => { cancelled = true }
  }, [user, authLoading])

  // keep the database in sync in the background for logged-in customers
  useEffect(() => {
    if (!user || mergedForUserId.current !== user.id) return
    const timer = setTimeout(() => replaceDbCart(user.id, items), SYNC_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [items, user])

  const addItem = (product, qty = 1) => {
    track('add_to_cart', {
      product_id: product.id,
      product_name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.price,
      quantity: qty,
    })
    setItems((prev) => {
      const cap = product.stock || 99
      const existing = prev.find((i) => i.id === product.id)
      if (existing) {
        return prev.map((i) =>
          i.id === product.id ? { ...i, qty: Math.min(i.qty + qty, cap) } : i
        )
      }
      return [...prev, { ...slim(product), qty: Math.min(qty, cap) }]
    })
  }

  const updateQty = (id, qty) =>
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: Math.max(1, Math.min(qty, i.stock || 99)) } : i))
    )

  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.id !== id))
  const clear = () => setItems([])

  const totals = useMemo(() => {
    const count = items.reduce((n, i) => n + i.qty, 0)
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
    const originalTotal = items.reduce((s, i) => s + i.originalPrice * i.qty, 0)
    return { count, subtotal, originalTotal, savings: originalTotal - subtotal }
  }, [items])

  return (
    <CartContext.Provider value={{ items, addItem, updateQty, removeItem, clear, ...totals }}>
      {children}
    </CartContext.Provider>
  )
}

export const useCart = () => {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
