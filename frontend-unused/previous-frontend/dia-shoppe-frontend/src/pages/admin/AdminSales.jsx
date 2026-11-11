import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchSaleEvents, createSaleEvent, updateSaleEvent, endSaleNow, deleteSaleEvent } from '../../lib/adminSales'
import { fetchAdminProducts } from '../../lib/adminCatalog'
import { setSaleThemeForced } from '../../lib/settings'
import { useCatalog } from '../../context/CatalogContext'
import { FiPlus, FiTag, FiX, FiTrash2, FiStopCircle, FiEdit2, FiClock, FiCheckCircle } from 'react-icons/fi'

// Admin switch for the storefront's sale DESIGN. The sale theme is ON whenever
// a sale event is live; this forces it on independently (to preview it or run
// the sale look without a discount event).
function SaleThemeToggle() {
  const { saleEvent, forcedSaleTheme } = useCatalog()
  const [on, setOn] = useState(forcedSaleTheme)
  const [saving, setSaving] = useState(false)
  const autoOn = !!saleEvent

  const toggle = async () => {
    const next = !on
    setSaving(true)
    setOn(next)
    document.documentElement.setAttribute('data-sale-theme', (next || autoOn) ? 'on' : 'off')
    const { error } = await setSaleThemeForced(next)
    if (error) setOn(!next) // revert on failure
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4 flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[220px]">
        <h2 className="font-display font-semibold text-ink-900 flex items-center gap-2"><FiTag size={16} className="text-secondary-500" /> Sale design</h2>
        <p className="text-sm text-gray-500 mt-1">
          The storefront switches to its sale look automatically while a sale is live.
          {autoOn
            ? <span className="text-emerald-600 font-medium"> A sale is live now, so the sale design is showing.</span>
            : ' Turn this on to force the sale design without a live sale (e.g. to preview it).'}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={saving || autoOn}
        title={autoOn ? 'A live sale already shows the sale design' : 'Force the sale design on/off'}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${(on || autoOn) ? 'bg-secondary-500' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${(on || autoOn) ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')
const dtLocal = (iso) => iso ? new Date(iso).toISOString().slice(0, 16) : ''
const fmt = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function statusOf(e) {
  const now = new Date()
  if (!e.isActive) return { label: 'Disabled', tint: 'bg-gray-100 text-gray-500' }
  if (now < new Date(e.startsAt)) return { label: 'Upcoming', tint: 'bg-amber-50 text-amber-600' }
  if (now > new Date(e.endsAt)) return { label: 'Ended', tint: 'bg-gray-100 text-gray-500' }
  return { label: 'Live', tint: 'bg-emerald-50 text-emerald-600' }
}

function SaleModal({ event, products, onClose, onSaved }) {
  const [name, setName] = useState(event?.name || '')
  const [bannerText, setBannerText] = useState(event?.bannerText || '')
  const [startsAt, setStartsAt] = useState(dtLocal(event?.startsAt) || dtLocal(new Date().toISOString()))
  const [endsAt, setEndsAt] = useState(dtLocal(event?.endsAt))
  const [selected, setSelected] = useState(() => {
    const m = new Map()
    for (const p of event?.products || []) m.set(p.productId, String(p.salePrice))
    return m
  })
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q))
  }, [products, search])

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, '')
      return next
    })
  }
  const setPrice = (id, value) => setSelected((prev) => new Map(prev).set(id, value))

  const handleSave = async () => {
    setError(null)
    if (!name.trim()) return setError('Give the sale a name.')
    if (!startsAt || !endsAt) return setError('Set a start and end date.')
    if (new Date(endsAt) <= new Date(startsAt)) return setError('End date must be after the start date.')
    if (selected.size === 0) return setError('Pick at least one product and its sale price.')

    const productList = []
    for (const [productId, price] of selected) {
      const num = Number(price)
      if (!price || Number.isNaN(num) || num < 0) {
        return setError('Every selected product needs a valid sale price.')
      }
      productList.push({ productId, salePrice: num })
    }

    setSaving(true)
    const payload = {
      name: name.trim(),
      bannerText: bannerText.trim(),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      products: productList,
    }
    const res = event ? await updateSaleEvent(event.id, payload) : await createSaleEvent(payload)
    setSaving(false)
    if (res.error) setError(res.error)
    else onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-display text-lg font-semibold text-ink-900">{event ? 'Edit Sale' : 'New Sale'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><FiX size={20} /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {error && <div className="bg-red-50 text-red-600 rounded-lg p-3 text-sm" role="alert">{error}</div>}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Sale name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali Health Sale"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Banner text (optional)</label>
            <input value={bannerText} onChange={(e) => setBannerText(e.target.value)} placeholder="e.g. Up to 30% off glucose monitors"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Starts</label>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Ends</label>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Products on sale ({selected.size} selected)</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500" />
            <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-50">
              {filtered.map((p) => {
                const checked = selected.has(p.id)
                return (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <input type="checkbox" checked={checked} onChange={() => toggle(p.id)} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink-900 truncate">{p.name}</div>
                      <div className="text-xs text-gray-400">{p.brand} · regular {inr(p.price)}</div>
                    </div>
                    {checked && (
                      <input
                        type="number" min="0" step="0.01" placeholder="Sale ₹"
                        value={selected.get(p.id)}
                        onChange={(e) => setPrice(p.id, e.target.value)}
                        className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                      />
                    )}
                  </div>
                )
              })}
              {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No products match.</p>}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-primary-700 text-white hover:bg-primary-800 disabled:opacity-60">
            {saving ? 'Saving…' : event ? 'Save Changes' : 'Create Sale'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminSales() {
  const [events, setEvents] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalEvent, setModalEvent] = useState(undefined) // undefined=closed, null=new, object=edit

  const load = () => {
    setLoading(true)
    Promise.all([fetchSaleEvents(), fetchAdminProducts()]).then(([salesRes, prodRes]) => {
      if (salesRes.error) setError(salesRes.error)
      else setEvents(salesRes.events)
      setProducts((prodRes.products || []).filter((p) => p.is_active))
      setLoading(false)
    })
  }

  useEffect(load, [])

  const handleEndNow = async (id) => {
    if (!confirm('End this sale immediately? Prices revert to normal right away.')) return
    await endSaleNow(id)
    load()
  }
  const handleDelete = async (id) => {
    if (!confirm('Delete this sale? This removes its history too.')) return
    await deleteSaleEvent(id)
    load()
  }

  return (
    <AdminLayout
      title="Sales"
      subtitle="Time-limited discounts that apply and revert on their own"
      actions={
        <button onClick={() => setModalEvent(null)} className="inline-flex items-center gap-1.5 bg-primary-700 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-primary-800">
          <FiPlus size={15} /> New Sale
        </button>
      }
    >
      {error && <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">Couldn't load sales: {error}</div>}

      <SaleThemeToggle />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <FiTag size={32} className="mx-auto text-gray-200 mb-3" />
          <h2 className="font-display font-semibold text-ink-900 mb-1">No sales yet</h2>
          <p className="text-sm text-gray-400 max-w-md mx-auto mb-4">
            Create a sale with a name, a date range and discounted prices — it shows on the storefront
            automatically while live and reverts by itself once it ends.
          </p>
          <button onClick={() => setModalEvent(null)} className="inline-flex items-center gap-1.5 bg-primary-700 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-primary-800">
            <FiPlus size={15} /> Create your first sale
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((e) => {
            const status = statusOf(e)
            const isLive = status.label === 'Live'
            return (
              <div key={e.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-display font-semibold text-ink-900">{e.name}</h3>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${status.tint}`}>
                        {isLive ? <FiCheckCircle size={11} /> : <FiClock size={11} />} {status.label}
                      </span>
                    </div>
                    {e.bannerText && <p className="text-sm text-gray-500 mb-1">{e.bannerText}</p>}
                    <p className="text-xs text-gray-400">{fmt(e.startsAt)} → {fmt(e.endsAt)} · {e.products.length} product{e.products.length === 1 ? '' : 's'}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => setModalEvent(e)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100" title="Edit"><FiEdit2 size={15} /></button>
                    {isLive && (
                      <button onClick={() => handleEndNow(e.id)} className="p-2 rounded-lg text-amber-600 hover:bg-amber-50" title="End now"><FiStopCircle size={15} /></button>
                    )}
                    <button onClick={() => handleDelete(e.id)} className="p-2 rounded-lg text-red-500 hover:bg-red-50" title="Delete"><FiTrash2 size={15} /></button>
                  </div>
                </div>
                {e.products.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-50">
                    {e.products.slice(0, 6).map((p) => (
                      <span key={p.productId} className="text-xs bg-secondary-50 text-secondary-700 px-2.5 py-1 rounded-full">
                        {p.name}: <span className="line-through text-secondary-400">{inr(p.regularPrice)}</span> {inr(p.salePrice)}
                      </span>
                    ))}
                    {e.products.length > 6 && <span className="text-xs text-gray-400 px-1 py-1">+{e.products.length - 6} more</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalEvent !== undefined && (
        <SaleModal
          event={modalEvent}
          products={products}
          onClose={() => setModalEvent(undefined)}
          onSaved={() => { setModalEvent(undefined); load() }}
        />
      )}
    </AdminLayout>
  )
}
