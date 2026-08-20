import { Link } from 'react-router-dom'
import { FiPhone, FiMail, FiMapPin, FiFacebook, FiInstagram, FiTwitter } from 'react-icons/fi'

export default function Footer() {
  return (
    <footer id="contact" className="relative overflow-hidden bg-black text-gray-300 pt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">D</span>
              </div>
              <div>
                <div className="text-white font-bold">Dia Shoppe</div>
                <div className="text-xs text-gray-400">Surgical Distributors</div>
              </div>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Trusted medical equipment distributor since 2004. Serving hospitals, clinics and individuals across India.
            </p>
            <div className="flex gap-3">
              <a href="#" className="text-gray-400 hover:text-primary-400 transition-colors"><FiFacebook size={20} /></a>
              <a href="#" className="text-gray-400 hover:text-primary-400 transition-colors"><FiInstagram size={20} /></a>
              <a href="#" className="text-gray-400 hover:text-primary-400 transition-colors"><FiTwitter size={20} /></a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-white font-semibold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="hover:text-white transition-colors">Home</Link></li>
              <li><Link to="/products" className="hover:text-white transition-colors">Products</Link></li>
              <li><Link to="/cart" className="hover:text-white transition-colors">Cart</Link></li>
              <li><Link to="/orders" className="hover:text-white transition-colors">My Orders</Link></li>
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h4 className="text-white font-semibold mb-4">Categories</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white transition-colors">Glucose Monitors</a></li>
              <li><a href="#" className="hover:text-white transition-colors">BP Monitors</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Nebulizers</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Hospital Equipment</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Oxygen Concentrators</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-white font-semibold mb-4">Contact Us</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <FiMapPin size={16} className="mt-0.5 text-primary-400 shrink-0" />
                <span>Dia Shoppe, India — PAN India Delivery</span>
              </li>
              <li className="flex items-center gap-2">
                <FiPhone size={16} className="text-primary-400 shrink-0" />
                <span>+91 98765 43210</span>
              </li>
              <li className="flex items-center gap-2">
                <FiMail size={16} className="text-primary-400 shrink-0" />
                <span>support@diashoppe.in</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800 py-4 px-4">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-gray-500 mb-2">
          <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
          <span aria-hidden="true">|</span>
          <Link to="/terms" className="hover:text-white transition-colors">Terms &amp; Conditions</Link>
          <span aria-hidden="true">|</span>
          <Link to="/refunds" className="hover:text-white transition-colors">Shipping, Returns &amp; Refunds</Link>
        </div>
        <div className="text-center text-xs text-gray-500">
          © {new Date().getFullYear()} Dia Shoppe Surgical Distributors. All rights reserved. &nbsp;|&nbsp; Trusted since 2004
        </div>
      </div>
    </footer>
  )
}
