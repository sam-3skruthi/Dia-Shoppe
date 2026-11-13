import { Link } from 'react-router-dom'
import { business } from '../data/business'
import { FiPhone, FiMail, FiMapPin, FiFacebook, FiInstagram, FiTwitter } from 'react-icons/fi'
import { social, isLink } from '../data/social'

// Only confirmed profile URLs (src/data/social.js) are shown — no placeholder '#' links.
const SOCIAL_LINKS = [
  ['instagram', 'Instagram', FiInstagram],
  ['facebook', 'Facebook', FiFacebook],
  ['twitter', 'Twitter', FiTwitter],
].filter(([key]) => isLink(social[key]?.url))

export default function Footer() {
  return (
    <footer id="contact" className="relative overflow-hidden bg-[#000000] text-dia-mint/80 pt-16">
      {/* pure black (owner request), with a thin electric-blue rule along the top */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-dia-aqua to-transparent" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-dia-mint shadow-[0_0_0_3px_rgba(0,180,216,0.35),0_10px_24px_-8px_rgba(0,180,216,0.6)]">
                <img src="/logos/ds-emblem.png" alt="" className="h-9 w-auto" />
              </span>
              <div>
                <div className="font-heading text-xl font-extrabold bg-gradient-to-r from-dia-mint via-dia-tea to-dia-aqua bg-clip-text text-transparent">Dia Shoppe</div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-dia-aqua">Surgical Distributors</div>
              </div>
            </div>
            <p className="text-sm text-dia-mint/60 mb-4">
              Trusted medical equipment distributor since 2004. Serving hospitals, clinics and individuals across India.
            </p>
            {SOCIAL_LINKS.length > 0 && (
              <div className="flex gap-3">
                {SOCIAL_LINKS.map(([key, label, Icon]) => (
                  <a key={key} href={social[key].url.trim()} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`} className="text-dia-mint/60 hover:text-dia-aqua transition-colors">
                    <Icon size={20} />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-heading font-bold text-dia-tea mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="hover:text-dia-aqua transition-colors">Home</Link></li>
              <li><Link to="/products" className="hover:text-dia-aqua transition-colors">Products</Link></li>
              <li><Link to="/cart" className="hover:text-dia-aqua transition-colors">Cart</Link></li>
              <li><Link to="/orders" className="hover:text-dia-aqua transition-colors">My Orders</Link></li>
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h4 className="font-heading font-bold text-dia-tea mb-4">Categories</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-dia-aqua transition-colors">Glucose Monitors</a></li>
              <li><a href="#" className="hover:text-dia-aqua transition-colors">BP Monitors</a></li>
              <li><a href="#" className="hover:text-dia-aqua transition-colors">Nebulizers</a></li>
              <li><a href="#" className="hover:text-dia-aqua transition-colors">Hospital Equipment</a></li>
              <li><a href="#" className="hover:text-dia-aqua transition-colors">Oxygen Concentrators</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-heading font-bold text-dia-tea mb-4">Contact Us</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <FiMapPin size={16} className="mt-0.5 text-dia-aqua shrink-0" />
                <span>{business.address}</span>
              </li>
              <li className="flex items-center gap-2">
                <FiPhone size={16} className="text-dia-aqua shrink-0" />
                <a href={`tel:${business.phone.replace(/\s/g, '')}`} className="hover:text-dia-aqua transition-colors">{business.phone.trim()}</a>
              </li>
              <li className="flex items-center gap-2">
                <FiMail size={16} className="text-dia-aqua shrink-0" />
                <a href={`mailto:${business.email}`} className="hover:text-dia-aqua transition-colors">{business.email}</a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="relative border-t border-dia-tea/15 py-4 px-4">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-dia-mint/50 mb-2">
          <Link to="/privacy" className="hover:text-dia-aqua transition-colors">Privacy Policy</Link>
          <span aria-hidden="true">|</span>
          <Link to="/terms" className="hover:text-dia-aqua transition-colors">Terms &amp; Conditions</Link>
          <span aria-hidden="true">|</span>
          <Link to="/refunds" className="hover:text-dia-aqua transition-colors">Shipping, Returns &amp; Refunds</Link>
        </div>
        <div className="text-center text-xs text-dia-mint/50">
          © {new Date().getFullYear()} Dia Shoppe Surgical Distributors. All rights reserved. &nbsp;|&nbsp; Trusted since 2004
        </div>
      </div>
    </footer>
  )
}
