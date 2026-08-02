import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchMyOrders, updateOrderStatus, onOrdersChange, ORDER_STATUSES } from '../../lib/orders'
import { exportCsv } from '../../lib/exportCsv'
import BarcodeScanner from '../../components/admin/BarcodeScanner'
import { FiChevronDown, FiPackage, FiTruck, FiX, FiDownload, FiCamera } from 'react-icons/fi'

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN')
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

const statusColor = (s) =>
  s === 'delivered' ? 'bg-emerald-50 text-emerald-600'
    : s === 'shipped' ? 'bg-blue-50 text-blue-600'
    : s === 'confirmed' ? 'bg-amber-50 text-amber-600'
    : s === 'paid' ? 'bg-secondary-50 text-secondary-700'
    : s === 'cancelled' ? 'bg-red-50 text-red-500'
    : 'bg-gray-100 text-gray-500' // pending

export default function AdminOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  const load = () =>
    fetchMyOrders().then(({ orders: list, error: err }) => {
      if (err) setError(err)
      else setOrders(list)
      setLoading(false)
    })

  useEffect(() => {
    load()
    // live refresh whenever any order changes (new checkout, payment, etc.)
    const unsubscribe = onOrdersChange(load)
    return unsubscribe
  }, [])

  // when marking shipped, collect courier + tracking number first
  const [shipModal, setShipModal] = useState(null) // { orderId, courier, trackingNumber }
  const [scanning, setScanning] = useState(false)  // camera barcode scanner open

  const changeStatus = async (id, status) => {
    if (status === 'shipped') {
      const existing = orders.find((o) => o.id === id)
      setShipModal({ orderId: id, courier: existing?.courier || '', trackingNumber: existing?.trackingNumber || '' })
      return
    }
    // optimistic update; reload from the DB either way
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, statusRaw: status, status: cap(status) } : o)))
    const { error: err } = await updateOrderStatus(id, status)
    if (err) setError(err)
    load()
  }

  const confirmShip = async (e) => {
    e.preventDefault()
    const { orderId, courier, trackingNumber } = shipModal
    setShipModal(null)
    const { error: err } = await updateOrderStatus(orderId, 'shipped', { courier, trackingNumber })
    if (err) setError(err)
    load()
  }

  const shown = filter === 'all' ? orders : orders.filter((o) => o.statusRaw === filter)

  const handleExport = () => {
    const today = new Date().toISOString().slice(0, 10)
    exportCsv(`dia-shoppe-orders-${today}.csv`, shown, [
      { label: 'Order ID', value: (o) => `#${o.id}` },
      { label: 'Date', value: (o) => fmtDate(o.date) },
      { label: 'Customer', value: (o) => o.customer?.name || '' },
      { label: 'City', value: (o) => o.customer?.city || '' },
      { label: 'Phone', value: (o) => o.customer?.phone || '' },
      { label: 'Items', value: (o) => o.items.reduce((n, i) => n + i.qty, 0) },
      { label: 'Payment', value: (o) => (o.paymentMethod === 'cod' ? 'COD' : 'Online') },
      { label: 'Total (INR)', value: (o) => o.totals.total },
      { label: 'Status', value: (o) => o.statusRaw },
      { label: 'Courier', value: (o) => o.courier || '' },
      { label: 'Tracking', value: (o) => o.trackingNumber || '' },
    ])
  }

  const exportBtn = (
    <button
      onClick={handleExport}
      disabled={shown.length === 0}
      className="inline-flex items-center gap-1.5 bg-primary-700 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <FiDownload size={15} /> Export ({shown.length})
    </button>
  )

  return (
    <AdminLayout title="Orders" subtitle={`${orders.length} orders placed`} actions={exportBtn}>
      {/* status filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {['all', ...ORDER_STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === s ? 'bg-primary-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === 'all' ? 'All' : cap(s)}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <FiPackage size={34} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No orders yet. Placed orders will appear here.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/60">
                  <th className="py-3 px-4 font-medium">Order ID</th>
                  <th className="py-3 px-4 font-medium">Customer</th>
                  <th className="py-3 px-4 font-medium">Date</th>
                  <th className="py-3 px-4 font-medium">Items</th>
                  <th className="py-3 px-4 font-medium">Payment</th>
                  <th className="py-3 px-4 font-medium text-right">Total</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-medium text-ink-900">#{o.id}</td>
                    <td className="py-3 px-4">
                      <div className="text-gray-700">{o.customer?.name || '—'}</div>
                      <div className="text-xs text-gray-400">{o.customer?.city || ''}</div>
                    </td>
                    <td className="py-3 px-4 text-gray-500">{fmtDate(o.date)}</td>
                    <td className="py-3 px-4 text-gray-500" title={o.items.map((i) => `${i.name} × ${i.qty}`).join('\n')}>
                      {o.items.reduce((n, i) => n + i.qty, 0)}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${o.paymentMethod === 'cod' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-600'}`}>
                        {o.paymentMethod === 'cod' ? 'COD' : 'Online'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-ink-900">{inr(o.totals.total)}</td>
                    <td className="py-3 px-4">
                      <div className="relative inline-block">
                        <select
                          value={o.statusRaw}
                          onChange={(e) => changeStatus(o.id, e.target.value)}
                          className={`appearance-none pr-7 pl-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer outline-none ${statusColor(o.statusRaw)}`}
                        >
                          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
                        </select>
                        <FiChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-current opacity-70" />
                      </div>
                      {(o.courier || o.trackingNumber) && (
                        <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-1">
                          <FiTruck size={11} /> {o.courier}{o.trackingNumber ? ` · ${o.trackingNumber}` : ''}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* mark-as-shipped dialog: courier + tracking number */}
      {shipModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setShipModal(null)} />
          <form onSubmit={confirmShip} className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <button type="button" onClick={() => setShipModal(null)} className="absolute top-4 right-4 text-gray-400 hover:text-ink-900" aria-label="Close">
              <FiX size={18} />
            </button>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900 mb-1">
              <FiTruck className="text-secondary-500" /> Mark Order #{shipModal.orderId} as Shipped
            </h2>
            <p className="text-xs text-gray-400 mb-4">The customer sees these details on their live tracking page.</p>
            <label className="block mb-3">
              <span className="text-sm font-medium text-gray-600">Courier</span>
              <input
                value={shipModal.courier}
                onChange={(e) => setShipModal((m) => ({ ...m, courier: e.target.value }))}
                placeholder="e.g. Delhivery, DTDC, Blue Dart"
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-secondary-400"
              />
            </label>
            <label className="block mb-5">
              <span className="text-sm font-medium text-gray-600">Tracking Number</span>
              <div className="mt-1 flex gap-2">
                <input
                  value={shipModal.trackingNumber}
                  onChange={(e) => setShipModal((m) => ({ ...m, trackingNumber: e.target.value }))}
                  placeholder="e.g. DL123456789IN"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-secondary-400"
                />
                <button
                  type="button"
                  onClick={() => setScanning(true)}
                  title="Scan the barcode on the courier label"
                  className="shrink-0 inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  <FiCamera size={16} /> Scan
                </button>
              </div>
            </label>
            <button type="submit" className="w-full bg-primary-700 text-white font-semibold py-2.5 rounded-full hover:bg-primary-800 transition-colors">
              Mark as Shipped
            </button>
          </form>
        </div>
      )}

      {scanning && (
        <BarcodeScanner
          onClose={() => setScanning(false)}
          onDetected={(code) => {
            setShipModal((m) => ({ ...m, trackingNumber: code }))
            setScanning(false)
          }}
        />
      )}
    </AdminLayout>
  )
}
