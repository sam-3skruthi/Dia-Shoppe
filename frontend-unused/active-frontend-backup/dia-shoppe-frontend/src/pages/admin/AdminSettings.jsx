import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchSaleThemeForced, setSaleThemeForced } from '../../lib/settings'
import { FiTag, FiMessageCircle, FiArrowRight, FiInfo, FiCheckCircle } from 'react-icons/fi'

/*
  Store settings — shop-wide switches that are not about WhatsApp wording.
  (The message wording now lives on the WhatsApp page, beside the log it
  affects, so each setting sits next to the thing it changes.)
*/

export default function AdminSettings() {
  const [saleForced, setSaleForced] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { fetchSaleThemeForced().then(setSaleForced) }, [])

  const toggleSale = async () => {
    const next = !saleForced
    setSaleForced(next)          // optimistic
    setSaving(true); setError(null)
    const { error: err } = await setSaleThemeForced(next)
    setSaving(false)
    if (err) { setError(err); setSaleForced(!next) }
    else { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  return (
    <AdminLayout title="Store Settings" subtitle="Shop-wide switches">
      {error && <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">{error}</div>}

      {/* sale theme */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        <div className="flex items-start gap-4">
          <span className="w-11 h-11 rounded-xl bg-secondary-50 flex items-center justify-center shrink-0">
            <FiTag size={20} className="text-secondary-600" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-semibold text-ink-900 flex items-center gap-2">
              Force sale theme
              {saved && <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><FiCheckCircle size={13} /> Saved</span>}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Turns the storefront's festive sale styling on even when no sale event is running — handy to preview it
              before a sale goes live. Leave it off and the theme switches itself on and off with the sale dates.
            </p>
            <Link to="/admin/sales" className="inline-flex items-center gap-1 text-xs text-primary-700 font-semibold hover:underline mt-2">
              Manage sale events <FiArrowRight size={12} />
            </Link>
          </div>

          <button
            onClick={toggleSale}
            disabled={saleForced === null || saving}
            role="switch"
            aria-checked={!!saleForced}
            aria-label="Force sale theme"
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
              saleForced ? 'bg-secondary-500' : 'bg-gray-300'
            }`}
          >
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              saleForced ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {/* pointer to where the message wording moved */}
      <div className="flex gap-2.5 text-sm text-gray-600 bg-blue-50/60 border border-blue-100 rounded-xl p-4">
        <FiInfo className="text-primary-600 shrink-0 mt-0.5" size={16} />
        <p>
          Looking for the WhatsApp message wording? It now lives on the{' '}
          <Link to="/admin/whatsapp" className="font-semibold text-primary-700 hover:underline inline-flex items-center gap-1">
            WhatsApp page <FiMessageCircle size={13} />
          </Link>{' '}
          under <strong>Message settings</strong>, right beside the log it affects.
        </p>
      </div>
    </AdminLayout>
  )
}
