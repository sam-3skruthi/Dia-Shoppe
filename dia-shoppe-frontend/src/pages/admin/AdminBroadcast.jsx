import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchAudience, fetchBroadcastHistory, sendBroadcast } from '../../lib/adminBroadcast'
import { uploadProductImage } from '../../lib/adminCatalog'
import {
  FiSend, FiUsers, FiInfo, FiCheckCircle, FiAlertTriangle, FiClock,
  FiImage, FiX, FiUpload,
} from 'react-icons/fi'

/*
  WhatsApp broadcast composer — a marketing message to every opted-in customer.
  Consent is enforced server-side; this page shows the reachable audience,
  a personalised message editor, a live phone-style preview, and past sends.
*/

// Messages are auto-greeted by the customer's name via the approved WhatsApp
// "promo" template, so the wording below is just the offer (no name greeting).
const TEMPLATES = [
  { id: 'blank', label: 'Blank', text: '' },
  { id: 'sale', label: 'Sale announcement', text: "🎉 Our Dia Shoppe sale is live — up to 25% off BP monitors, glucometers & more. Shop now before stock runs out!" },
  { id: 'restock', label: 'Back in stock', text: "Good news — items you may need are back in stock at Dia Shoppe. Order today for fast PAN-India delivery." },
  { id: 'festive', label: 'Festive offer', text: "Wishing you good health this season! Enjoy special festive prices on trusted medical equipment at Dia Shoppe." },
]

export default function AdminBroadcast() {
  const [audience, setAudience] = useState(null)
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState([])
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)

  const loadHistory = () => fetchBroadcastHistory().then((r) => !r.error && setHistory(r.sends))

  useEffect(() => {
    fetchAudience().then((r) => { if (r.error) setError(r.error); else setAudience(r.count) })
    loadHistory()
  }, [])

  const preview = message.replace(/\{\{\s*name\s*\}\}/gi, 'Ramesh')
  const charCount = message.length

  const pickImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }
  const clearImage = () => { setImageFile(null); setImagePreview(null) }

  const doSend = async () => {
    setConfirming(false)
    setSending(true)
    setError(null)
    setResult(null)

    // upload the image first (if one was attached) → public URL for WhatsApp
    let imageUrl = null
    if (imageFile) {
      const { url, error: upErr } = await uploadProductImage(imageFile)
      if (upErr) { setError(`Image upload failed: ${upErr}`); setSending(false); return }
      imageUrl = url
    }

    const { result: res, error: err } = await sendBroadcast(message, imageUrl)
    setSending(false)
    if (err) { setError(err); return }
    setResult(res)
    loadHistory()
  }

  return (
    <AdminLayout title="Broadcast" subtitle="Send a WhatsApp message to opted-in customers">
      {error && <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">{error}</div>}

      <div className="grid lg:grid-cols-3 gap-4">
        {/* composer */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-ink-900">Compose message</h2>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-600 bg-secondary-50 px-3 py-1 rounded-full">
                <FiUsers size={14} /> {audience === null ? '…' : audience} recipient{audience === 1 ? '' : 's'}
              </span>
            </div>

            {/* template quick-picks */}
            <div className="flex flex-wrap gap-2 mb-3">
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => setMessage(t.text)}
                  className="text-xs font-medium px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100">
                  {t.label}
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              placeholder="Write your message… use {{name}} to greet each customer by name."
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary-400 resize-none"
            />
            <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
              <span>Each customer is automatically greeted by name — just write the offer.</span>
              <span>{charCount} characters</span>
            </div>

            {/* poster image — required (the WhatsApp marketing template has an image header) */}
            <div className="mt-4">
              {imagePreview ? (
                <div className="relative inline-block">
                  <img src={imagePreview} alt="Broadcast" className="max-h-40 rounded-xl border border-gray-200" />
                  <button onClick={clearImage} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center text-gray-500 hover:text-red-500" aria-label="Remove image">
                    <FiX size={14} />
                  </button>
                </div>
              ) : (
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700 cursor-pointer hover:underline">
                  <FiImage size={16} /> Add a poster image <span className="text-gray-400 font-normal">(required)</span>
                  <input type="file" accept="image/*" onChange={pickImage} className="hidden" />
                </label>
              )}
            </div>

            <button
              onClick={() => setConfirming(true)}
              disabled={!message.trim() || !imageFile || sending || !audience}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-primary-700 text-white font-semibold px-6 py-3 rounded-full hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiSend size={17} /> {sending ? 'Sending…' : `Send to ${audience ?? 0} customers`}
            </button>
          </div>

          {result && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-sm text-emerald-800 flex items-start gap-2">
              <FiCheckCircle className="mt-0.5 shrink-0" />
              <span>Broadcast complete — <b>{result.sent}</b> sent{result.failed ? `, ${result.failed} failed` : ''} across an audience of {result.audience}.</span>
            </div>
          )}

          {/* history */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-display font-semibold text-ink-900 mb-3">Recent sends</h2>
            {history.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No broadcasts sent yet.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="flex items-start gap-3 text-sm border-b border-gray-50 last:border-0 pb-2">
                    <FiClock size={13} className="text-gray-300 mt-1 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-gray-700 truncate">{h.message_text.replace('[hello_world fallback] ', '')}</div>
                      <div className="text-[11px] text-gray-400">{h.phone_number} · {new Date(h.sent_at).toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* preview + rules */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-display font-semibold text-ink-900 mb-3">Preview</h2>
            <div className="rounded-2xl bg-[#e5ddd5] p-3 min-h-[120px]">
              <div className="bg-[#dcf8c6] rounded-lg rounded-tr-none p-1.5 shadow-sm max-w-[90%] ml-auto">
                {imagePreview && <img src={imagePreview} alt="" className="rounded-md mb-1.5 w-full object-cover max-h-40" />}
                <div className="px-1.5 py-1 text-sm text-gray-800 whitespace-pre-wrap">
                  {preview || <span className="text-gray-400">Your message appears here…</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-sm text-gray-600 space-y-3">
            <h2 className="font-display font-semibold text-ink-900 flex items-center gap-2"><FiInfo size={15} className="text-secondary-500" /> Good to know</h2>
            <p className="flex gap-2"><FiCheckCircle size={15} className="text-emerald-500 shrink-0 mt-0.5" /> Only customers who ticked the WhatsApp box at checkout are messaged — no one else.</p>
            <p className="flex gap-2"><FiAlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" /> Marketing messages need a Meta-approved template to deliver. Until yours is approved, sends fall back to a test template so you can trial the flow.</p>
            <p className="flex gap-2"><FiInfo size={15} className="text-gray-400 shrink-0 mt-0.5" /> Meta charges roughly ₹0.80 per marketing message — use broadcasts sparingly.</p>
          </div>
        </div>
      </div>

      {/* confirm modal */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirming(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="font-display text-xl font-semibold text-ink-900">Send this broadcast?</h2>
            <p className="text-sm text-gray-600 mt-2">
              This will message <b>{audience}</b> opted-in customer{audience === 1 ? '' : 's'} on WhatsApp.
              At ~₹0.80 each, that&rsquo;s about <b>₹{Math.round((audience || 0) * 0.8)}</b>.
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={doSend} className="px-5 py-2 rounded-lg text-sm font-semibold bg-primary-700 text-white hover:bg-primary-800">Yes, send</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
