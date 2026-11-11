import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchLeads, sendCartReminder } from '../../lib/adminLeads'
import { exportCsv } from '../../lib/exportCsv'
import {
  FiSearch, FiPhone, FiClock, FiShoppingCart, FiSend,
  FiCheckCircle, FiAlertCircle, FiMessageCircle, FiCompass, FiDownload,
} from 'react-icons/fi'
import { FaInstagram, FaFacebookF, FaGoogle, FaWhatsapp, FaYoutube } from 'react-icons/fa'

// channel icon + colour for the "where leads come from" display
const SOURCE_META = {
  Instagram: { icon: FaInstagram, color: '#E1306C' },
  Facebook: { icon: FaFacebookF, color: '#1877F2' },
  Google: { icon: FaGoogle, color: '#4285F4' },
  WhatsApp: { icon: FaWhatsapp, color: '#25D366' },
  YouTube: { icon: FaYoutube, color: '#FF0000' },
  Direct: { icon: FiCompass, color: '#64748b' },
}
const sourceMeta = (s) => SOURCE_META[s] || { icon: FiCompass, color: '#64748b' }

/*
  Leads = customers with an open cart who haven't checked out. Abandoned carts
  (untouched > 1h) are the ones worth a WhatsApp nudge; the "Send reminder"
  button only works for customers who opted in to WhatsApp marketing.
*/

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')

const timeAgo = (d) => {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function StatTile({ icon: Icon, label, value, tint }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tint}`}><Icon size={17} /></span>
      <div className="mt-2 text-xl font-bold text-ink-900">{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  )
}

export default function AdminLeads() {
  const [leads, setLeads] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | abandoned | active
  const [sending, setSending] = useState({})   // userId → 'sending' | 'sent' | 'error'

  const load = () =>
    fetchLeads().then((res) => {
      if (res.error) setError(res.error)
      else { setLeads(res.leads); setStats(res.stats) }
      setLoading(false)
    })

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter((l) =>
      (filter === 'all' || l.status === filter) &&
      (!q || [l.name, l.email, l.phone].some((v) => v && v.toLowerCase().includes(q)))
    )
  }, [leads, search, filter])

  const remind = async (lead) => {
    setSending((s) => ({ ...s, [lead.userId]: 'sending' }))
    const { error: err } = await sendCartReminder(lead.userId)
    setSending((s) => ({ ...s, [lead.userId]: err ? 'error' : 'sent' }))
  }

  const chips = [
    { key: 'all', label: 'All open carts' },
    { key: 'abandoned', label: 'Abandoned' },
    { key: 'active', label: 'Still shopping' },
  ]

  const handleExport = () => {
    const today = new Date().toISOString().slice(0, 10)
    exportCsv(`dia-shoppe-leads-${today}.csv`, filtered, [
      { label: 'Name', value: 'name' },
      { label: 'Email', value: 'email' },
      { label: 'Phone', value: 'phone' },
      { label: 'Source', value: 'source' },
      { label: 'Items', value: 'items' },
      { label: 'Cart value (INR)', value: (l) => Math.round(l.value) },
      { label: 'Status', value: 'status' },
      { label: 'Last active', value: (l) => new Date(l.lastActive).toLocaleString('en-IN') },
      { label: 'WhatsApp opt-in', value: (l) => (l.optedIn ? 'Yes' : 'No') },
    ])
  }

  const exportBtn = (
    <button
      onClick={handleExport}
      disabled={filtered.length === 0}
      className="inline-flex items-center gap-1.5 bg-primary-700 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <FiDownload size={15} /> Export ({filtered.length})
    </button>
  )

  return (
    <AdminLayout title="Leads" subtitle="Customers with items in their cart who haven't checked out" actions={exportBtn}>
      {error && <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">Couldn't load leads: {error}</div>}

      {/* stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatTile icon={FiShoppingCart} label="Open carts" value={stats?.total ?? '—'} tint="bg-primary-50 text-primary-700" />
        <StatTile icon={FiAlertCircle} label="Abandoned (>1h)" value={stats?.abandoned ?? '—'} tint="bg-amber-50 text-amber-600" />
        <StatTile icon={FiShoppingCart} label="Value at risk" value={stats ? inr(Math.round(stats.abandonedValue)) : '—'} tint="bg-emerald-50 text-emerald-600" />
        <StatTile icon={FiMessageCircle} label="Reachable on WhatsApp" value={stats?.reachable ?? '—'} tint="bg-secondary-50 text-secondary-600" />
      </div>

      {/* where leads come from */}
      {stats?.bySource?.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
          <h2 className="font-display font-semibold text-ink-900 mb-3 flex items-center gap-2">
            <FiCompass size={16} className="text-secondary-500" /> Where leads come from
          </h2>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {stats.bySource.map((s) => {
              const meta = sourceMeta(s.source)
              const pct = Math.round((s.count / stats.total) * 100)
              return (
                <div key={s.source} className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: meta.color }}>
                    <meta.icon size={14} />
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-ink-900 leading-tight">{s.source}</div>
                    <div className="text-[11px] text-gray-400 leading-tight">{s.count} lead{s.count === 1 ? '' : 's'} · {pct}%</div>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-3 pt-3 border-t border-gray-50">
            First-touch source of customers with an open cart — shows which platform is driving the most leads.
          </p>
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-2">
          {chips.map((c) => (
            <button key={c.key} onClick={() => setFilter(c.key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === c.key ? 'bg-primary-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <FiSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone…"
            className="bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary-300/30" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/60">
                <th className="py-3 px-4 font-medium">Customer</th>
                <th className="py-3 px-4 font-medium">Cart</th>
                <th className="py-3 px-4 font-medium text-right">Value</th>
                <th className="py-3 px-4 font-medium">Last active</th>
                <th className="py-3 px-4 font-medium">WhatsApp</th>
                <th className="py-3 px-4 font-medium text-right">Reminder</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={6} className="py-4 px-4"><div className="h-9 bg-gray-100 rounded-lg animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400">
                  {leads.length === 0 ? 'No open carts right now.' : 'No leads match this filter.'}
                </td></tr>
              ) : (
                filtered.map((l) => {
                  const state = sending[l.userId]
                  return (
                    <tr key={l.userId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 align-top">
                      <td className="py-3 px-4">
                        <div className="font-medium text-ink-900 flex items-center gap-2">
                          {l.name}
                          {l.status === 'abandoned'
                            ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">Abandoned</span>
                            : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">Shopping</span>}
                        </div>
                        <div className="text-xs text-gray-400">{l.email}</div>
                        {l.phone && <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><FiPhone size={10} /> {l.phone}</div>}
                        {(() => {
                          const meta = sourceMeta(l.source)
                          return (
                            <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium" style={{ color: meta.color }}>
                              <meta.icon size={10} /> {l.source}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        <div className="text-xs">{l.items} item{l.items === 1 ? '' : 's'}</div>
                        <div className="text-[11px] text-gray-400 max-w-[220px] truncate">
                          {l.products.map((p) => `${p.name}×${p.qty}`).join(', ')}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-ink-900">{inr(Math.round(l.value))}</td>
                      <td className="py-3 px-4 text-gray-500 whitespace-nowrap"><span className="flex items-center gap-1"><FiClock size={12} className="text-gray-400" /> {timeAgo(l.lastActive)}</span></td>
                      <td className="py-3 px-4">
                        {l.optedIn && l.phone
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><FiCheckCircle size={12} /> Opted in</span>
                          : <span className="text-[11px] text-gray-400">{l.phone ? 'No consent' : 'No number'}</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {state === 'sent' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><FiCheckCircle size={13} /> Sent</span>
                        ) : (
                          <button
                            onClick={() => remind(l)}
                            disabled={!l.optedIn || !l.phone || state === 'sending'}
                            title={!l.optedIn || !l.phone ? 'Needs WhatsApp opt-in + a phone number' : 'Send a cart reminder on WhatsApp'}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-secondary-500 text-white hover:bg-secondary-600 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <FiSend size={12} /> {state === 'sending' ? 'Sending…' : state === 'error' ? 'Retry' : 'Remind'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-3">
        A cart clears automatically when its order is placed, so everything here is a genuinely open cart.
        Reminders only reach customers who ticked the WhatsApp box at checkout.
      </p>
    </AdminLayout>
  )
}
