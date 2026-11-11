/*
  Shared product catalog + taxonomy used by the Products listing, Product
  Detail and Home pages. This is mock data standing in for the Supabase
  catalog — shapes mirror what the real API will return so swapping later is
  a drop-in (id, slug, name, brand, category, price, originalPrice, stock…).
*/

import { FiActivity, FiHeart, FiWind, FiCpu, FiUsers, FiThermometer } from 'react-icons/fi'

export const categories = [
  { slug: 'glucose',     label: 'Glucose Monitors',   icon: FiActivity,    desc: 'Accu-Chek, OneTouch, Freestyle & more' },
  { slug: 'bp',          label: 'BP Monitors',        icon: FiHeart,       desc: 'Omron & digital BP apparatus' },
  { slug: 'respiratory', label: 'Respiratory',        icon: FiWind,        desc: 'Nebulizers, oxygen, CPAP / BiPAP' },
  { slug: 'hospital',    label: 'Hospital Equipment', icon: FiCpu,         desc: 'Beds, patient care, furniture' },
  { slug: 'mobility',    label: 'Walking Aids',       icon: FiUsers,       desc: 'Wheelchairs, walkers, mobility' },
  { slug: 'devices',     label: 'Other Devices',      icon: FiThermometer, desc: 'Stethoscopes, massagers, suction' },
]

export const brands = [
  'Roche', 'OneTouch', 'Freestyle', 'Omron', 'Philips',
  'Dr. Morepen', 'Bayer', 'BPL', 'Littmann', 'Arkray',
]

export const products = [
  { id: 1,  slug: 'accu-chek-instant-s',     name: 'Accu-Chek Instant S Glucometer',     brand: 'Roche',       category: 'glucose',     price: 1299, originalPrice: 1599, badge: 'Best Seller', stock: 24, rating: 5 },
  { id: 2,  slug: 'omron-hem-7120',          name: 'Omron HEM-7120 BP Monitor',          brand: 'Omron',       category: 'bp',          price: 1850, originalPrice: 2200, badge: 'Popular',     stock: 12, rating: 5 },
  { id: 3,  slug: 'philips-portable-nebulizer', name: 'Philips Portable Nebulizer',      brand: 'Philips',     category: 'respiratory', price: 3499, originalPrice: 4200, badge: 'Top Pick',    stock: 7,  rating: 4 },
  { id: 4,  slug: 'onetouch-select-plus',    name: 'OneTouch Select Plus Glucometer',    brand: 'OneTouch',    category: 'glucose',     price: 999,  originalPrice: 1299, badge: null,          stock: 31, rating: 4 },
  { id: 5,  slug: 'dr-morepen-gluco-one',    name: 'Dr. Morepen Gluco One BG-03',        brand: 'Dr. Morepen', category: 'glucose',     price: 649,  originalPrice: 849,  badge: 'New',         stock: 40, rating: 4 },
  { id: 6,  slug: 'contour-plus',            name: 'Contour Plus Glucometer',            brand: 'Bayer',       category: 'glucose',     price: 1150, originalPrice: 1450, badge: null,          stock: 0,  rating: 4 },
  { id: 7,  slug: 'freestyle-libre-sensor',  name: 'Freestyle Libre Sensor',             brand: 'Freestyle',   category: 'glucose',     price: 4999, originalPrice: 5500, badge: 'Premium',     stock: 5,  rating: 5 },
  { id: 8,  slug: 'omron-hem-7361t',         name: 'Omron HEM-7361T BP Monitor (AFib)',  brand: 'Omron',       category: 'bp',          price: 4250, originalPrice: 4990, badge: null,          stock: 9,  rating: 5 },
  { id: 9,  slug: 'bpl-oxy-5-concentrator',  name: 'BPL Oxy 5 Oxygen Concentrator',      brand: 'BPL',         category: 'respiratory', price: 38999, originalPrice: 44999, badge: null,         stock: 3,  rating: 4 },
  { id: 10, slug: 'philips-respironics-cpap', name: 'Philips DreamStation CPAP',          brand: 'Philips',     category: 'respiratory', price: 42999, originalPrice: 49999, badge: 'Top Pick',  stock: 2,  rating: 5 },
  { id: 11, slug: 'littmann-classic-iii',    name: 'Littmann Classic III Stethoscope',   brand: 'Littmann',    category: 'devices',     price: 8499, originalPrice: 9500, badge: 'Best Seller', stock: 18, rating: 5 },
  { id: 12, slug: 'arkray-glucocard-01',     name: 'Arkray Glucocard 01-mini',           brand: 'Arkray',      category: 'glucose',     price: 749,  originalPrice: 999,  badge: null,          stock: 22, rating: 4 },
  { id: 13, slug: 'fowler-hospital-bed',     name: 'Semi-Fowler Hospital Bed (2-Function)', brand: 'BPL',      category: 'hospital',    price: 24999, originalPrice: 29999, badge: null,        stock: 4,  rating: 4 },
  { id: 14, slug: 'foldable-wheelchair',     name: 'Foldable Steel Wheelchair',          brand: 'BPL',         category: 'mobility',    price: 6999, originalPrice: 8499, badge: 'Popular',     stock: 14, rating: 4 },
  { id: 15, slug: 'aluminium-walker',        name: 'Adjustable Aluminium Walker',        brand: 'BPL',         category: 'mobility',    price: 1899, originalPrice: 2400, badge: null,          stock: 27, rating: 4 },
  { id: 16, slug: 'omron-nebulizer-ne-c101', name: 'Omron NE-C101 Compressor Nebulizer', brand: 'Omron',       category: 'respiratory', price: 2199, originalPrice: 2699, badge: null,          stock: 16, rating: 4 },
  { id: 17, slug: 'digital-thermometer',     name: 'Dr. Morepen Digital Thermometer',    brand: 'Dr. Morepen', category: 'devices',     price: 149,  originalPrice: 249,  badge: null,          stock: 60, rating: 4 },
  { id: 18, slug: 'pulse-oximeter',          name: 'BPL Smart Pulse Oximeter',           brand: 'BPL',         category: 'devices',     price: 1099, originalPrice: 1499, badge: 'Best Seller', stock: 33, rating: 5 },
]

export const getProductBySlug = (slug) => products.find((p) => p.slug === slug)
export const getCategory = (slug) => categories.find((c) => c.slug === slug)
