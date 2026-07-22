import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import SaleBanner from '../components/SaleBanner'
import SaleSpotlight from '../components/SaleSpotlight'
import SaleDoodle from '../components/SaleDoodle'
import ProductCard from '../components/ProductCard'
import PageBackground from '../components/PageBackground'
import { Reveal, Stagger, StaggerItem } from '../components/motion'
import { categories } from '../data/products'
import { useCatalog } from '../context/CatalogContext'
import { FiX, FiSliders, FiSearch } from 'react-icons/fi'

const PRICE_MAX = 50000

const sortOptions = [
  { value: 'popular',    label: 'Most Popular' },
  { value: 'price-asc',  label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'discount',   label: 'Biggest Discount' },
]

export default function Products() {
  const { products, brands, loading, saleMode } = useCatalog()
  const [searchParams, setSearchParams] = useSearchParams()

  const [query, setQuery] = useState('')
  const [activeCats, setActiveCats] = useState(
    searchParams.get('category') ? [searchParams.get('category')] : []
  )
  const [activeBrands, setActiveBrands] = useState([])
  const [maxPrice, setMaxPrice] = useState(PRICE_MAX)
  const [inStockOnly, setInStockOnly] = useState(false)
  const [sort, setSort] = useState('popular')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      const matchesQuery =
        !query ||
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.brand.toLowerCase().includes(query.toLowerCase())
      const matchesCat = activeCats.length === 0 || activeCats.includes(p.category)
      const matchesBrand = activeBrands.length === 0 || activeBrands.includes(p.brand)
      const matchesPrice = p.price <= maxPrice
      const matchesStock = !inStockOnly || p.stock > 0
      return matchesQuery && matchesCat && matchesBrand && matchesPrice && matchesStock
    })

    const discountOf = (p) => (p.originalPrice - p.price) / p.originalPrice
    list = [...list].sort((a, b) => {
      if (sort === 'price-asc') return a.price - b.price
      if (sort === 'price-desc') return b.price - a.price
      if (sort === 'discount') return discountOf(b) - discountOf(a)
      return (b.rating - a.rating) || (b.stock - a.stock) // popular
    })
    return list
  }, [products, query, activeCats, activeBrands, maxPrice, inStockOnly, sort])

  const clearAll = () => {
    setQuery('')
    setActiveCats([])
    setActiveBrands([])
    setMaxPrice(PRICE_MAX)
    setInStockOnly(false)
    setSearchParams({})
  }

  const activeFilterCount =
    activeCats.length + activeBrands.length + (inStockOnly ? 1 : 0) + (maxPrice < PRICE_MAX ? 1 : 0)

  /* ── Filter panel (shared between desktop sidebar + mobile drawer) ── */
  const FilterPanel = () => (
    <div className="space-y-8">
      <div>
        <h3 className="font-display text-lg font-semibold text-ink-900 mb-3">Category</h3>
        <div className="space-y-2">
          {categories.map((c) => (
            <label key={c.slug} className="flex items-center gap-2.5 text-sm text-gray-600 cursor-pointer hover:text-ink-900">
              <input
                type="checkbox"
                checked={activeCats.includes(c.slug)}
                onChange={() => toggle(activeCats, setActiveCats, c.slug)}
                className="w-4 h-4 rounded border-gray-300 text-secondary-500 focus:ring-secondary-400"
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold text-ink-900 mb-3">Brand</h3>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {brands.map((b) => (
            <label key={b} className="flex items-center gap-2.5 text-sm text-gray-600 cursor-pointer hover:text-ink-900">
              <input
                type="checkbox"
                checked={activeBrands.includes(b)}
                onChange={() => toggle(activeBrands, setActiveBrands, b)}
                className="w-4 h-4 rounded border-gray-300 text-secondary-500 focus:ring-secondary-400"
              />
              {b}
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold text-ink-900 mb-3">Max Price</h3>
        <input
          type="range"
          min={500}
          max={PRICE_MAX}
          step={500}
          value={maxPrice}
          onChange={(e) => setMaxPrice(Number(e.target.value))}
          className="w-full accent-secondary-500"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>₹500</span>
          <span className="font-semibold text-primary-700">Up to ₹{maxPrice.toLocaleString()}</span>
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2.5 text-sm text-gray-600 cursor-pointer hover:text-ink-900">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={() => setInStockOnly(!inStockOnly)}
            className="w-4 h-4 rounded border-gray-300 text-secondary-500 focus:ring-secondary-400"
          />
          In stock only
        </label>
      </div>

      {activeFilterCount > 0 && (
        <button
          onClick={clearAll}
          className="text-sm font-semibold text-primary-700 hover:underline flex items-center gap-1"
        >
          <FiX size={14} /> Clear all filters
        </button>
      )}
    </div>
  )

  return (
    <div className="min-h-screen">
      <PageBackground />
      <Header />
      <SaleBanner />

      {/* ── Page header band ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-ink-950 via-primary-950 to-ink-950 text-white">
        <div className="absolute top-0 right-0 w-96 h-96 bg-secondary-500/20 rounded-full blur-3xl animate-blob-slow" aria-hidden="true" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-12">
            <Reveal className="flex-1">
              <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-tight">
                Quality equipment<br className="hidden sm:block" /> for every need
              </h1>
              <p className="text-blue-100/80 mt-3 max-w-xl text-lg">
                Authentic glucose &amp; BP monitors, respiratory support and hospital
                essentials — from the brands clinicians trust, delivered across India.
              </p>
            </Reveal>
            {/* sale spotlight / deal of the day — swaps to the doodle SALE while the sale design is on */}
            <Reveal className="w-full lg:w-[360px] shrink-0">
              {saleMode ? <SaleDoodle /> : <SaleSpotlight onShopSale={() => setSort('discount')} />}
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Toolbar + content ── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Mobile search */}
        <div className="md:hidden mb-5">
          <div className="flex w-full border border-gray-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-secondary-400">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, brands…"
              className="flex-1 px-4 py-2.5 text-sm outline-none"
            />
            <span className="bg-primary-700 text-white px-4 flex items-center"><FiSearch size={18} /></span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mb-6">
          <p className="text-sm text-gray-500">
            <span className="font-semibold text-ink-900">{filtered.length}</span>{' '}
            {filtered.length === 1 ? 'product' : 'products'}
          </p>
          <div className="flex items-center gap-3">
            {/* Desktop search */}
            <div className="hidden md:flex border border-gray-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-secondary-400">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products, brands…"
                className="w-64 px-3 py-2 text-sm outline-none"
              />
              <span className="bg-primary-700 text-white px-3 flex items-center"><FiSearch size={16} /></span>
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-secondary-400 text-gray-700"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => setFiltersOpen(true)}
              className="lg:hidden flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-700"
            >
              <FiSliders size={16} /> Filters
              {activeFilterCount > 0 && (
                <span className="bg-secondary-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{activeFilterCount}</span>
              )}
            </button>
          </div>
        </div>

        <div className="flex gap-8">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-24 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <FilterPanel />
            </div>
          </aside>

          {/* Grid */}
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-100 h-64 animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-gray-100">
                <p className="text-gray-500 mb-3">No products match your filters.</p>
                <button onClick={clearAll} className="text-primary-700 font-semibold hover:underline">
                  Clear all filters
                </button>
              </div>
            ) : (
              <Stagger className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                {filtered.map((p) => (
                  <StaggerItem key={p.id}><ProductCard product={p} /></StaggerItem>
                ))}
              </Stagger>
            )}
          </div>
        </div>
      </section>

      {/* ── Mobile filter drawer ── */}
      {filtersOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setFiltersOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-80 max-w-[85%] bg-white shadow-2xl p-6 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-xl font-semibold text-ink-900">Filters</h2>
              <button onClick={() => setFiltersOpen(false)} className="p-1 text-gray-500 hover:text-ink-900">
                <FiX size={22} />
              </button>
            </div>
            <FilterPanel />
            <button
              onClick={() => setFiltersOpen(false)}
              className="mt-8 w-full bg-primary-700 text-white font-semibold py-2.5 rounded-lg hover:bg-primary-800 transition-colors"
            >
              Show {filtered.length} results
            </button>
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}
