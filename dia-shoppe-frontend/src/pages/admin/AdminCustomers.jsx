import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchCustomers } from '../../lib/adminCustomers'
import { exportCsv } from '../../lib/exportCsv'
import { FiMail, FiPhone, FiMapPin, FiSearch, FiShield, FiDownload } from 'react-icons/fi'

/*
  Registered users from Supabase (user_profiles + per-user order totals).
  Read-only for now — promoting/demoting admins from this page is a planned
  follow-up so the owner never needs the Supabase dashboard for it.
*/

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')
const dateFmt = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function AdminCustomers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchCustomers().then((res) => {
      if (cancelled) return
      if (res.error) setError(res.error)
      else setCustomers(res.customers)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter((c) =>
      [c.name, c.email, c.phone].some((v) => v && v.toLowerCase().includes(q))
    )
  }, [customers, search])

  const customerCount = customers.filter((c) => c.role === 'customer').length

  const handleExport = () => {
    const today = new Date().toISOString().slice(0, 10)
    exportCsv(`dia-shoppe-customers-${today}.csv`, filtered, [
      { label: 'Name', value: (c) => (c.name === '—' ? '' : c.name) },
      { label: 'Email', value: 'email' },
      { label: 'Phone', value: 'phone' },
      { label: 'City', value: 'city' },
      { label: 'State', value: 'state' },
      { label: 'Joined', value: (c) => dateFmt(c.joined) },
      { label: 'Orders', value: 'orders' },
      { label: 'Total spent (INR)', value: (c) => c.spent || 0 },
      { label: 'Role', value: 'role' },
    ])
  }

  const exportBtn = (
    <button
      onClick={handleExport}
      disabled={loading || filtered.length === 0}
      className="inline-flex items-center gap-1.5 bg-primary-700 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <FiDownload size={15} /> Export ({filtered.length})
    </button>
  )

  return (
    <AdminLayout
      title="Customers"
      subtitle={loading ? 'Loading…' : `${customerCount} customer${customerCount === 1 ? '' : 's'} · ${customers.length - customerCount} staff`}
      actions={exportBtn}
    >
      {error && (
        <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">Couldn't load customers: {error}</div>
      )}

      <div className="relative mb-4 max-w-sm">
        <FiSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or phone…"
          className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/60">
                <th className="py-3 px-4 font-medium">Customer</th>
                <th className="py-3 px-4 font-medium">Phone</th>
                <th className="py-3 px-4 font-medium">Location</th>
                <th className="py-3 px-4 font-medium">Joined</th>
                <th className="py-3 px-4 font-medium text-right">Orders</th>
                <th className="py-3 px-4 font-medium text-right">Total spent</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td colSpan={6} className="py-4 px-4"><div className="h-9 bg-gray-100 rounded-lg animate-pulse" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-gray-400">
                    {search ? 'No users match your search.' : 'No registered users yet.'}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-full bg-secondary-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
                          {(c.name !== '—' ? c.name : c.email || '?').charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-ink-900 flex items-center gap-1.5">
                            <span className="truncate">{c.name}</span>
                            {c.role === 'admin' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700 shrink-0">
                                <FiShield size={10} /> Admin
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 flex items-center gap-1 truncate"><FiMail size={11} className="shrink-0" /> {c.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                      {c.phone ? <span className="flex items-center gap-1"><FiPhone size={12} className="text-gray-400" /> {c.phone}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                      {c.city ? (
                        <span className="flex items-center gap-1"><FiMapPin size={12} className="text-gray-400" /> {c.city}{c.state ? `, ${c.state}` : ''}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{dateFmt(c.joined)}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{c.orders}</td>
                    <td className="py-3 px-4 text-right font-semibold text-ink-900">{c.spent > 0 ? inr(c.spent) : <span className="text-gray-300 font-normal">—</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-3">Location comes from each customer's most recent delivery address. Total spent excludes pending and cancelled orders.</p>
    </AdminLayout>
  )
}
