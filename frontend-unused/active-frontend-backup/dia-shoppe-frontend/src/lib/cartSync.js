import { supabase } from './supabase'

/*
  Syncs a logged-in customer's cart to the cart_items table so it follows
  them to a new device. Guests stay localStorage-only (see CartContext).
  Full-replace strategy on every sync — cart sizes are small (a handful of
  items), so delete-then-insert is simpler and safer than diffing.
*/

export async function fetchDbCart(userId) {
  const { data, error } = await supabase
    .from('cart_items')
    .select('product_id, quantity, products(id, slug, name, brand, price, original_price, stock_qty, is_active, categories(slug))')
    .eq('user_id', userId)
  if (error) return { error: error.message, items: [] }

  const items = (data || [])
    .filter((row) => row.products?.is_active) // drop items whose product was hidden/deleted meanwhile
    .map((row) => ({
      id: row.products.id,
      slug: row.products.slug,
      name: row.products.name,
      brand: row.products.brand,
      category: row.products.categories?.slug || null,
      price: Number(row.products.price),
      originalPrice: row.products.original_price != null ? Number(row.products.original_price) : Number(row.products.price),
      stock: row.products.stock_qty,
      qty: row.quantity,
    }))
  return { items }
}

export async function replaceDbCart(userId, items) {
  const del = await supabase.from('cart_items').delete().eq('user_id', userId)
  if (del.error) console.error('[cart-debug] delete error', del.error)
  if (items.length === 0) return
  const rows = items.map((i) => ({ user_id: userId, product_id: i.id, quantity: i.qty }))
  const ins = await supabase.from('cart_items').upsert(rows, { onConflict: 'user_id,product_id' })
  if (ins.error) console.error('[cart-debug] upsert error', ins.error)
  return ins
}
