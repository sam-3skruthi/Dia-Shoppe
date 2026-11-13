import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from './motion'
import { getCategory } from '../data/products'
import { useCart } from '../context/CartContext'

/*
  Shared product card used on Home (Featured) and the Products grid.
  Editorial style: rounded-2xl, soft teal product plate, magnetic hover lift,
  category-aware icon, price + discount, stock-aware CTA.
*/
export default function ProductCard({ product }) {
  const discount = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
  const inStock = product.stock > 0
  const Icon = getCategory(product.category)?.icon
  const { addItem } = useCart()
  const [added, setAdded] = useState(false)

  const handleAdd = () => {
    addItem(product)
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className="group h-full flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-secondary-200 transition-shadow overflow-hidden"
    >
      <Link to={`/products/${product.slug}`} className="block">
        <div className="relative bg-secondary-50 h-44 flex items-center justify-center overflow-hidden">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="w-20 h-20 bg-white rounded-xl shadow-sm flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
              {Icon && <Icon className="text-secondary-500" size={36} />}
            </div>
          )}
          {product.badge && (
            <span className="absolute top-2 left-2 bg-secondary-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
              {product.badge}
            </span>
          )}
          {discount > 0 && (
            <span className="absolute top-2 right-2 bg-primary-700 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
              {discount}% OFF
            </span>
          )}
          {!inStock && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
              <span className="text-gray-500 font-semibold text-sm">Out of Stock</span>
            </div>
          )}
        </div>
      </Link>

      <div className="p-4 flex flex-col flex-1">
        <div className="text-xs text-gray-400 mb-0.5">{product.brand}</div>
        <Link
          to={`/products/${product.slug}`}
          className="font-semibold text-gray-800 mb-2 text-sm leading-snug hover:text-primary-700 transition-colors line-clamp-2"
        >
          {product.name}
        </Link>

        <div className="flex items-center gap-2 mb-2 mt-auto">
          <span className="text-lg font-bold text-primary-700">₹{product.price.toLocaleString()}</span>
          <span className="text-sm text-gray-400 line-through">₹{product.originalPrice.toLocaleString()}</span>
        </div>

        {inStock ? (
          <div className="text-xs text-secondary-600 font-medium mb-3">
            {product.stock <= 5 ? `Only ${product.stock} left` : 'In stock'}
          </div>
        ) : (
          <div className="text-xs text-gray-400 mb-3">Currently unavailable</div>
        )}

        <button
          onClick={handleAdd}
          disabled={!inStock}
          className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors active:scale-[0.98]
            disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed
            ${added ? 'bg-secondary-500 text-white' : 'bg-primary-700 text-white hover:bg-primary-800'}`}
        >
          {!inStock ? 'Out of Stock' : added ? 'Added ✓' : 'Add to Cart'}
        </button>
      </div>
    </motion.div>
  )
}
