import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchMessageSettings, saveMessageSettings, DEFAULT_MESSAGES } from '../../lib/settings'
import {
  FiSave, FiRotateCcw, FiCheckCircle, FiTruck, FiHome, FiXCircle,
  FiMessageCircle, FiShoppingCart, FiCpu, FiInfo,
} from 'react-icons/fi'

/*
  Message Settings — lets the owner edit the fill-in wording of WhatsApp
  messages (order-status sentences, AI chatbot tone, cart-reminder text)
  without code or Meta. Saved to site_settings; the Edge Functions read it live.
*/

const ORDER_FIELDS = [
  { key: 'status_confirmed', label: 'When order is confirmed', icon: FiCheckCircle, tint: 'text-secondary-600' },
  { key: 'status_shipped', label: 'When order is shipped', icon: FiTruck, tint: 'text-indigo-600', note: 'Used only when no courier/tracking is added — otherwise the courier + tracking number is sent.' },
  { key: 'status_delivered', label: 'When order is delivered', icon: FiHome, tint: 'text-emerald-600' },
  { key: 'status_cancelled', label: 'When order is cancelled', icon: FiXCircle, tint: 'text-red-500' },
]

function Field({ label, icon: Icon, tint, note, value, onChange, rows = 2 }) {
  return (
    <label className="block">
      <span className={`flex items-center gap-2 text-sm font-medium text-gray-700 mb-1`}>
        {Icon && <Icon size={15} className={tint} />} {label}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-secondary-400 resize-none"
      />
      {note && <span className="block text-xs text-gray-400 mt-1">{note}</span>}
    </label>
  )
}

export default function AdminSettings() {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchMessageSettings().then(setForm)
  }, [])

  const set = (key, val) => { setForm((f) => ({ ...f, [key]: val })); setSaved(false) }

  const save = async () => {
    setSaving(true); setError(null)
    const { error: err } = await saveMessageSettings(form)
    setSaving(false)
    if (err) setError(err)
    else { setSaved(true); setTimeout(() => setSaved(false), 3000) }
  }

  const resetDefaults = () => { setForm({ ...DEFAULT_MESSAGES }); setSaved(false) }

  if (!form) {
    return (
      <AdminLayout title="Message Settings" subtitle="Loading…">
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>
      </AdminLayout>
    )
  }

  const saveBtn = (
    <div className="flex items-center gap-2">
      {saved && <span className="text-sm text-emerald-600 font-medium flex items-center gap-1"><FiCheckCircle size={15} /> Saved</span>}
      <button onClick={resetDefaults} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:bg-gray-100 rounded-lg px-3 py-2" title="Reset all wording to the original defaults">
        <FiRotateCcw size={14} /> Reset
      </button>
      <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-primary-700 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-primary-800 disabled:opacity-60">
        <FiSave size={15} /> {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )

  return (
    <AdminLayout title="Message Settings" subtitle="Edit what your automatic WhatsApp messages say" actions={saveBtn}>
      {error && <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">{error}</div>}

      <div className="flex gap-2.5 text-sm text-gray-600 bg-blue-50/60 border border-blue-100 rounded-xl p-4 mb-5">
        <FiInfo className="text-primary-600 shrink-0 mt-0.5" size={16} />
        <p>
          These are the wording changes you can make instantly — no Meta approval needed. The fixed part of each
          message (e.g. <em>"Hi {'{name}'}, your Dia Shoppe order #{'{id}'} is now {'{status}'}…"</em>) is a Meta
          template edited in Meta Business Manager.
        </p>
      </div>

      {/* order-update sentences */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="font-display font-semibold text-ink-900 mb-1 flex items-center gap-2"><FiMessageCircle size={17} className="text-secondary-500" /> Order update messages</h2>
        <p className="text-xs text-gray-400 mb-4">The sentence added to each automatic order-status WhatsApp.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {ORDER_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} icon={f.icon} tint={f.tint} note={f.note} value={form[f.key]} onChange={(v) => set(f.key, v)} />
          ))}
        </div>
      </div>

      {/* AI chatbot */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <h2 className="font-display font-semibold text-ink-900 mb-1 flex items-center gap-2"><FiCpu size={17} className="text-secondary-500" /> AI chatbot instructions</h2>
        <p className="text-xs text-gray-400 mb-4">How the AI assistant should behave when replying to customers on WhatsApp. Describe the tone and any rules.</p>
        <Field label="Instructions to the AI" value={form.ai_instructions} onChange={(v) => set('ai_instructions', v)} rows={5} />
      </div>

      {/* cart reminder */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-display font-semibold text-ink-900 mb-1 flex items-center gap-2"><FiShoppingCart size={17} className="text-secondary-500" /> Cart reminder</h2>
        <p className="text-xs text-gray-400 mb-4">The nudge sent to customers who left items in their cart (from the Leads page).</p>
        <Field label="Reminder message" value={form.cart_reminder} onChange={(v) => set('cart_reminder', v)} rows={2} />
      </div>
    </AdminLayout>
  )
}
