/*
  Mock order persistence (localStorage) — stands in for the future Supabase
  `orders` table. Checkout writes an order here; Order Confirmation and the
  Orders page read it back. Shapes mirror what the real API will return.
*/
const STORAGE_KEY = 'diashoppe_orders'

export const getOrders = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []
  } catch {
    return []
  }
}

export const getOrder = (id) => getOrders().find((o) => o.id === id)

export const saveOrder = (order) => {
  const all = getOrders()
  all.unshift(order)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  return order
}

export const makeOrderId = () =>
  'DS' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10)

// Admin: order fulfilment stages, in order.
export const ORDER_STATUSES = ['Confirmed', 'Packed', 'Shipped', 'Delivered']

const saveAll = (all) => localStorage.setItem(STORAGE_KEY, JSON.stringify(all))

export const updateOrderStatus = (id, status) => {
  const all = getOrders().map((o) => (o.id === id ? { ...o, status } : o))
  saveAll(all)
  return all
}
