import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AdminAssistant from './AdminAssistant'
import {
  FiGrid, FiBox, FiShoppingBag, FiUsers, FiStar, FiMessageCircle,
  FiTrendingUp, FiLogOut, FiExternalLink, FiSearch, FiBell, FiMenu, FiX, FiTag,
  FiTarget, FiSend, FiShare2, FiSettings,
} from 'react-icons/fi'

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: FiGrid, end: true },
  { to: '/admin/products', label: 'Products', icon: FiBox },
  { to: '/admin/orders', label: 'Orders', icon: FiShoppingBag },
  { to: '/admin/sales', label: 'Sales', icon: FiTag },
  { to: '/admin/leads', label: 'Leads', icon: FiTarget },
  { to: '/admin/customers', label: 'Customers', icon: FiUsers },
  { to: '/admin/reviews', label: 'Reviews', icon: FiStar },
  { to: '/admin/whatsapp', label: 'WhatsApp', icon: FiMessageCircle },
  { to: '/admin/broadcast', label: 'Broadcast', icon: FiSend },
  { to: '/admin/social', label: 'Social', icon: FiShare2 },
  { to: '/admin/analytics', label: 'Analytics', icon: FiTrendingUp },
  { to: '/admin/settings', label: 'Settings', icon: FiSettings },
]

function SidebarContent({ onNavigate }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full">
      {/* brand */}
      <Link to="/admin" onClick={onNavigate} className="flex items-center gap-2 px-5 h-16 shrink-0">
        <img src="/logos/ds-emblem.png" alt="" className="h-8 w-auto" />
        <span className="font-display font-bold text-lg text-white">Dia Shoppe</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary-300 bg-white/10 rounded px-1.5 py-0.5">Admin</span>
      </Link>

      {/* nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 text-[11px] uppercase tracking-wider text-blue-200/50 font-semibold mb-2">Main Menu</div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive ? 'bg-secondary-500 text-white' : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <item.icon size={18} /> {item.label}
          </NavLink>
        ))}

        <div className="px-3 text-[11px] uppercase tracking-wider text-blue-200/50 font-semibold mb-2 mt-5">Store</div>
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-blue-100/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          <FiExternalLink size={18} /> View Storefront
        </Link>
        <button
          onClick={() => { logout(); navigate('/') }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-blue-100/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          <FiLogOut size={18} /> Logout
        </button>
      </nav>

      {/* user */}
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-3 px-2 py-2">
          <span className="w-9 h-9 rounded-full bg-secondary-500 text-white text-sm font-bold flex items-center justify-center">
            {user?.name?.charAt(0).toUpperCase() || 'A'}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{user?.name || 'Admin'}</div>
            <div className="text-xs text-blue-200/60">Super Admin</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminLayout({ title, subtitle, actions, children }) {
  const [mobileNav, setMobileNav] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* fixed sidebar (desktop) */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-gradient-to-b from-ink-950 via-primary-950 to-ink-950">
        <SidebarContent />
      </aside>

      {/* mobile drawer */}
      {mobileNav && (
        <>
          <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setMobileNav(false)} />
          <aside className="lg:hidden fixed inset-y-0 left-0 w-64 bg-gradient-to-b from-ink-950 via-primary-950 to-ink-950 z-50">
            <button onClick={() => setMobileNav(false)} className="absolute top-4 right-4 text-white/70"><FiX size={20} /></button>
            <SidebarContent onNavigate={() => setMobileNav(false)} />
          </aside>
        </>
      )}

      {/* content */}
      <div className="lg:pl-64">
        {/* topbar */}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-100">
          <div className="flex items-center gap-4 px-4 sm:px-6 h-16">
            <button className="lg:hidden text-gray-600" onClick={() => setMobileNav(true)}><FiMenu size={22} /></button>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-lg sm:text-xl font-semibold text-ink-900 leading-tight truncate">{title}</h1>
              {subtitle && <p className="text-xs text-gray-400 truncate">{subtitle}</p>}
            </div>
            <div className="hidden md:flex items-center border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50 text-gray-400">
              <FiSearch size={15} />
              <input placeholder="Search…" className="bg-transparent outline-none text-sm px-2 w-40 text-gray-700" />
            </div>
            {actions}
            <button className="relative text-gray-500 hover:text-gray-700">
              <FiBell size={20} />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-secondary-500 rounded-full" />
            </button>
          </div>
        </header>

        <main className="p-4 sm:p-6 max-w-[1400px]">{children}</main>
      </div>

      {/* AI co-pilot — available on every admin page */}
      <AdminAssistant />
    </div>
  )
}
