import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FiShoppingCart, FiUser, FiSearch, FiMenu, FiX,
  FiPackage, FiLogOut, FiGrid,
} from 'react-icons/fi'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'

/*
  `overlay` = transparent header that floats over the hero so the hero
  background shows through seamlessly (used on the landing page). It scrolls
  away with the page. Other pages use the default solid white header.

  `brandReady` / `brandRef` support the landing-page intro animation: the hero
  shows a big centred logo that flies up and "lands" here. While that plays the
  header brand is hidden (`brandReady=false`); `brandRef` lets the intro measure
  this exact spot to fly to.
*/
export default function Header({ showSearch = false, overlay = false, brandReady = true, brandRef = null }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const { count } = useCart()
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    setProfileOpen(false)
    setMenuOpen(false)
    navigate('/')
  }

  const headerCls = overlay
    ? 'absolute top-0 inset-x-0 z-50 bg-transparent'
    : 'sticky top-0 z-50 bg-[#F2FFF6]/85 backdrop-blur-md border-b border-primary-100 shadow-[0_8px_24px_-20px_rgba(2,18,37,0.45)]'
  const link = overlay
    ? 'text-sm text-white/85 hover:text-white font-medium transition-colors'
    : 'text-sm text-gray-600 hover:text-primary-700 font-medium'

  return (
    <header className={`w-full ${headerCls}`}>
      {/* Main nav */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link
            to="/"
            ref={brandRef}
            className="shrink-0 inline-flex items-center gap-2 transition-opacity duration-300"
            style={{ opacity: brandReady ? 1 : 0 }}
          >
            <img
              src="/logos/ds-emblem.png"
              alt="Dia Shoppe"
              className={`h-9 sm:h-10 w-auto ${overlay ? 'drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]' : ''}`}
            />
            <span className="font-display font-bold leading-none text-lg sm:text-2xl tracking-tight">
              <span className={overlay ? 'text-white drop-shadow' : 'text-primary-800'}>Dia </span>
              <span className={overlay ? 'text-secondary-300 drop-shadow' : 'text-secondary-600'}>Shoppe</span>
            </span>
          </Link>

          {/* Search bar — desktop, only when enabled */}
          {showSearch && (
            <div className="hidden md:flex flex-1 max-w-xl mx-8">
              <div className="flex w-full border border-primary-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary-300 bg-white">
                <input
                  type="text"
                  placeholder="Search products, brands..."
                  className="flex-1 px-4 py-2 text-sm outline-none"
                />
                <button className="bg-primary-700 text-white px-4 hover:bg-primary-800 transition-colors">
                  <FiSearch size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            <Link to="/" className={link}>Home</Link>
            <Link to="/products" className={link}>Products</Link>
            <Link to="/#about" className={link}>About</Link>
            <Link to="/#contact" className={link}>Contact</Link>
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setProfileOpen((o) => !o)}
                  className="flex items-center"
                  aria-label="Account menu"
                >
                  <span className="w-9 h-9 rounded-full bg-secondary-500 text-white text-sm font-bold flex items-center justify-center hover:bg-secondary-600 transition-colors ring-2 ring-white/30">
                    {user.name?.charAt(0).toUpperCase()}
                  </span>
                </button>

                {profileOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} aria-hidden="true" />
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <div className="text-sm font-semibold text-ink-900 truncate">{user.name}</div>
                        <div className="text-xs text-gray-400 truncate">{user.email}</div>
                      </div>
                      <Link
                        to="/orders"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-secondary-50"
                      >
                        <FiPackage size={16} className="text-secondary-500" /> My Orders
                      </Link>
                      {isAdmin && (
                        <Link
                          to="/admin"
                          onClick={() => setProfileOpen(false)}
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-secondary-50"
                        >
                          <FiGrid size={16} className="text-secondary-500" /> Admin Dashboard
                        </Link>
                      )}
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-secondary-50"
                      >
                        <FiLogOut size={16} className="text-secondary-500" /> Log out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Link to="/login" className={`flex items-center gap-1 ${link}`}>
                <FiUser size={18} />
                <span>Login</span>
              </Link>
            )}
            <Link to="/cart" className="relative flex items-center gap-1 bg-secondary-500 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-secondary-600 transition-colors">
              <FiShoppingCart size={18} />
              <span>Cart</span>
              {count > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary-700 text-white text-xs min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center font-bold">{count}</span>
              )}
            </Link>
          </nav>

          {/* Mobile menu button */}
          <button className={`md:hidden p-2 ${overlay ? 'text-white' : 'text-gray-700'}`} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <FiX size={22} /> : <FiMenu size={22} />}
          </button>
        </div>

        {/* Mobile search — only when enabled */}
        {showSearch && (
          <div className="md:hidden pb-3">
            <div className="flex border border-primary-200 rounded-xl overflow-hidden bg-white">
              <input type="text" placeholder="Search products..." className="flex-1 px-4 py-2 text-sm outline-none" />
              <button className="bg-primary-700 text-white px-4"><FiSearch size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile menu drawer */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 px-4 py-4 flex flex-col gap-4 shadow-lg">
          <Link to="/" className="text-gray-700 font-medium" onClick={() => setMenuOpen(false)}>Home</Link>
          <Link to="/products" className="text-gray-700 font-medium" onClick={() => setMenuOpen(false)}>Products</Link>
          <Link to="/#about" className="text-gray-700" onClick={() => setMenuOpen(false)}>About</Link>
          <Link to="/#contact" className="text-gray-700" onClick={() => setMenuOpen(false)}>Contact</Link>
          <Link to="/cart" className="text-gray-700" onClick={() => setMenuOpen(false)}>Cart</Link>
          {user ? (
            <>
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <span className="w-7 h-7 rounded-full bg-secondary-500 text-white text-xs font-bold flex items-center justify-center">
                  {user.name?.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm font-semibold text-ink-900 truncate">{user.name}</span>
              </div>
              <Link to="/orders" className="flex items-center gap-2 text-gray-700" onClick={() => setMenuOpen(false)}>
                <FiPackage size={16} className="text-secondary-500" /> My Orders
              </Link>
              <button onClick={handleLogout} className="flex items-center gap-2 text-gray-700 text-left">
                <FiLogOut size={16} className="text-secondary-500" /> Log out
              </button>
            </>
          ) : (
            <Link to="/login" className="text-gray-700" onClick={() => setMenuOpen(false)}>Login / Signup</Link>
          )}
        </div>
      )}
    </header>
  )
}
