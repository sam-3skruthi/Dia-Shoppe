import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { trackPageview } from './lib/analytics'
import { captureFirstTouch } from './lib/attribution'
import { CartProvider } from './context/CartContext'
import { AuthProvider } from './context/AuthContext'
import { CatalogProvider } from './context/CatalogContext'
import Home from './pages/Home'
import Products from './pages/Products'
import ProductDetail from './pages/ProductDetail'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import OrderConfirmation from './pages/OrderConfirmation'
import Orders from './pages/Orders'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Refunds from './pages/Refunds'
import AdminRoute from './components/admin/AdminRoute'
import AdminDashboard from './pages/admin/Dashboard'
import AdminProducts from './pages/admin/AdminProducts'
import AdminOrders from './pages/admin/AdminOrders'
import AdminSales from './pages/admin/AdminSales'
import AdminLeads from './pages/admin/AdminLeads'
import AdminCustomers from './pages/admin/AdminCustomers'
import AdminReviews from './pages/admin/AdminReviews'
import AdminWhatsApp from './pages/admin/AdminWhatsApp'
import AdminBroadcast from './pages/admin/AdminBroadcast'
import AdminSocial from './pages/admin/AdminSocial'
import AdminAnalytics from './pages/admin/AdminAnalytics'
import AdminSettings from './pages/admin/AdminSettings'
import SiteEffects from './components/SiteEffects'
import { LiquidGlassDefs } from './components/ui/buttons'

// Per-route browser-tab titles. Exact paths first; prefixes handled below.
const TITLES = {
  '/': 'Dia Shoppe — Medical & Surgical Equipment | Since 2004',
  '/products': 'Shop Equipment — Dia Shoppe',
  '/cart': 'My Cart — Dia Shoppe',
  '/checkout': 'Checkout — Dia Shoppe',
  '/orders': 'My Orders — Dia Shoppe',
  '/login': 'Sign In — Dia Shoppe',
  '/signup': 'Create Account — Dia Shoppe',
  '/privacy': 'Privacy Policy — Dia Shoppe',
  '/terms': 'Terms & Conditions — Dia Shoppe',
  '/refunds': 'Shipping, Returns & Refunds — Dia Shoppe',
}
function titleFor(pathname) {
  if (TITLES[pathname]) return TITLES[pathname]
  if (pathname.startsWith('/products/')) return 'Product Details — Dia Shoppe'
  if (pathname.startsWith('/order-confirmation')) return 'Order Confirmed — Dia Shoppe'
  if (pathname.startsWith('/admin')) return 'Admin Dashboard — Dia Shoppe'
  return 'Dia Shoppe — Medical & Surgical Equipment'
}

// SPA route changes don't reload the page, so fire a PostHog pageview manually
// and keep the browser-tab title in sync with the current route.
function PageviewTracker() {
  const { pathname } = useLocation()
  useEffect(() => {
    trackPageview()
    document.title = titleFor(pathname)
  }, [pathname])
  return null
}

function App() {
  // record where this visitor first came from (Instagram/Facebook/Google/…)
  useEffect(() => { captureFirstTouch() }, [])

  return (
    <AuthProvider>
      <CatalogProvider>
      <CartProvider>
        <BrowserRouter>
          <PageviewTracker />
          <SiteEffects />
          {/* the shared liquid-glass SVG filter (glass buttons + glass pills), once for every page */}
          <LiquidGlassDefs />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/:slug" element={<ProductDetail />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/order-confirmation/:id" element={<OrderConfirmation />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Login signup />} />

            {/* Admin — gated by role (client-side guard; real enforcement via backend later) */}
            <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/products" element={<AdminRoute><AdminProducts /></AdminRoute>} />
            <Route path="/admin/orders" element={<AdminRoute><AdminOrders /></AdminRoute>} />
            <Route path="/admin/sales" element={<AdminRoute><AdminSales /></AdminRoute>} />
            <Route path="/admin/leads" element={<AdminRoute><AdminLeads /></AdminRoute>} />
            <Route path="/admin/customers" element={<AdminRoute><AdminCustomers /></AdminRoute>} />
            <Route path="/admin/reviews" element={<AdminRoute><AdminReviews /></AdminRoute>} />
            <Route path="/admin/whatsapp" element={<AdminRoute><AdminWhatsApp /></AdminRoute>} />
            <Route path="/admin/broadcast" element={<AdminRoute><AdminBroadcast /></AdminRoute>} />
            <Route path="/admin/social" element={<AdminRoute><AdminSocial /></AdminRoute>} />
            <Route path="/admin/analytics" element={<AdminRoute><AdminAnalytics /></AdminRoute>} />
            <Route path="/admin/settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />

            {/* Legal — linked from the footer; Razorpay and Meta check these */}
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/refunds" element={<Refunds />} />

            {/* Catch-all 404 — keep last */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </CartProvider>
      </CatalogProvider>
    </AuthProvider>
  )
}

export default App
