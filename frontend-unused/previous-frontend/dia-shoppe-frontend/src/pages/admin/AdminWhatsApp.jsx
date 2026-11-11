import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchWhatsAppLog } from '../../lib/adminWhatsApp'
import {
  FiMessageCircle, FiSend, FiAlertTriangle, FiList, FiInfo, FiCheckCircle, FiTruck, FiHome, FiXCircle,
} from 'react-icons/fi'

/*
  Live WhatsApp automation dashboard — reads the whatsapp_messages log that
  the whatsapp-notify Edge Function writes on every order-status change.
  Templates are managed in Meta Business (they need Meta approval), so this
  page shows the log + the triggers, not a template editor.
*/

const fmtTime = (iso) =>
  new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })

const TYPE_META = {
  confirmed: { icon: FiCheckCircle, tint: 'bg-secondary-50 text-secondary-700' },
  shipped: { icon: FiTruck, tint: 'bg-indigo-50 text-indigo-600' },
  delivered: { icon: FiHome, tint: 'bg-emerald-50 text-emerald-600' },
  cancelled: { icon: FiXCircle, tint: 'bg-red-50 text-red-500' },
}

const OUTCOME_BADGE = {
  sent: ['Sent', 'bg-emerald-50 text-emerald-600'],
  fallback: ['Sent (test template)', 'bg-amber-50 text-amber-600'],
  failed: ['Failed', 'bg-red-50 text-red-500'],
}

const TRIGGERS = [
  { when: 'Order confirmed (COD placed / payment done + worker confirms)', message: 'We are preparing it for dispatch.' },
  { when: 'Order shipped (worker adds courier + tracking no)', message: 'Courier name + tracking number' },
  { when: 'Order delivered', message: 'Delivery thank-you' },
  { when: 'Order cancelled', message: 'Cancellation + refund note' },
]

export default function AdminWhatsApp() {
  const [messages, setMessages] = useState([])
  const [stats, setStats] = useState({ total: 0, sent: 0, failed: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchWhatsAppLog().then((res) => {
      if (cancelled) return
      if (res.error) setError(res.error)
      else {
        setMessages(res.messages)
        setStats(res.stats)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <AdminLayout title="WhatsApp Automation" subtitle="Automatic order updates to customers' WhatsApp">
      {/* status */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-3 mb-4">
        <span className="w-11 h-11 rounded-xl bg-secondary-50 flex items-center justify-center"><FiMessageCircle className="text-secondary-600" size={22} /></span>
        <div>
          <div className="font-semibold text-ink-900">Automation is active</div>
          <div className="text-xs text-gray-400">Messages send automatically whenever an order's status changes — no worker action needed</div>
        </div>
        <span className="ml-auto text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-600">Active</span>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">Couldn't load messages: {error}</div>
      )}

      {/* stat tiles */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[
          { icon: FiList, label: 'Total attempts', value: stats.total, tint: 'bg-primary-50 text-primary-700' },
          { icon: FiSend, label: 'Sent', value: stats.sent, tint: 'bg-emerald-50 text-emerald-600' },
          { icon: FiAlertTriangle, label: 'Failed', value: stats.failed, tint: 'bg-red-50 text-red-500' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.tint}`}><s.icon size={18} /></span>
            <div className="mt-3 text-xl font-bold text-ink-900">{loading ? '…' : s.value}</div>
            <div className="text-xs text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* message log */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-gray-100 font-display font-semibold text-ink-900">Message log</div>
        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400 py-10 text-center">No messages yet — they'll appear when order statuses change.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/60">
                  <th className="py-3 px-5 font-medium">When</th>
                  <th className="py-3 px-5 font-medium">Order</th>
                  <th className="py-3 px-5 font-medium">Update</th>
                  <th className="py-3 px-5 font-medium">To</th>
                  <th className="py-3 px-5 font-medium">Message</th>
                  <th className="py-3 px-5 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => {
                  const meta = TYPE_META[m.type]
                  const [label, badge] = OUTCOME_BADGE[m.outcome] || OUTCOME_BADGE.sent
                  return (
                    <tr key={m.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 align-top">
                      <td className="py-3 px-5 text-gray-500 whitespace-nowrap">{fmtTime(m.at)}</td>
                      <td className="py-3 px-5">
                        {m.orderId ? (
                          <Link to="/admin/orders" className="font-medium text-primary-700 hover:underline">#{m.orderId}</Link>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-5">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${meta?.tint || 'bg-gray-100 text-gray-500'}`}>
                          {meta && <meta.icon size={11} />} {m.type}
                        </span>
                      </td>
                      <td className="py-3 px-5 text-gray-600 whitespace-nowrap font-mono text-xs">+{m.phone}</td>
                      <td className="py-3 px-5 text-gray-600 max-w-[320px]">
                        <span className="line-clamp-2" title={m.text}>{m.text}</span>
                      </td>
                      <td className="py-3 px-5 text-right">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${badge}`}>{label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* triggers reference */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 font-display font-semibold text-ink-900">When messages are sent</div>
        <div className="divide-y divide-gray-50">
          {TRIGGERS.map((t) => (
            <div key={t.when} className="px-5 py-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-ink-900 font-medium flex-1 min-w-[240px]">{t.when}</span>
              <span className="text-gray-500">{t.message}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2.5 text-sm text-gray-500 bg-blue-50/60 border border-blue-100 rounded-xl p-4 mt-4">
        <FiInfo className="text-primary-600 shrink-0 mt-0.5" size={16} />
        <p>
          Currently running on Meta's <strong>test number</strong> — messages only reach verified test phones.
          Going live needs Meta business verification and the shop's own number; message wording is a Meta-approved
          template (edited in Meta Business Manager, not here). "Sent (test template)" means the real wording is
          still under Meta review and the sandbox template was used instead.
        </p>
      </div>
    </AdminLayout>
  )
}
