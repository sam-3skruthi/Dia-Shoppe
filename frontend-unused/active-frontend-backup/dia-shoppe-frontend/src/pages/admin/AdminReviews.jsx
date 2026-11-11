import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout'
import { fetchAllFeedback, setFeedbackHidden } from '../../lib/feedback'
import { FiStar, FiEyeOff, FiEye } from 'react-icons/fi'

/*
  Order reviews from the feedback table. Customers submit one review per order
  from the order tracking page once it's delivered (see lib/feedback.js).
*/

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function AdminReviews() {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () =>
    fetchAllFeedback().then((res) => {
      if (res.error) setError(res.error)
      else setReviews(res.reviews)
      setLoading(false)
    })

  useEffect(() => { load() }, [])

  const toggleHidden = async (r) => {
    // optimistic flip, then persist
    setReviews((list) => list.map((x) => (x.id === r.id ? { ...x, hidden: !x.hidden } : x)))
    const { error: err } = await setFeedbackHidden(r.id, !r.hidden)
    if (err) { setError(err); load() }
  }

  // public-facing average & distribution use only VISIBLE reviews, so hiding a
  // spam/abusive review actually corrects the rating customers would see
  const visible = reviews.filter((r) => !r.hidden)
  const avg = visible.length ? (visible.reduce((s, r) => s + r.rating, 0) / visible.length).toFixed(1) : null
  const dist = [5, 4, 3, 2, 1].map((r) => ({ r, count: visible.filter((f) => f.rating === r).length }))
  const max = Math.max(1, ...dist.map((d) => d.count))
  const hiddenCount = reviews.length - visible.length

  if (loading) {
    return (
      <AdminLayout title="Reviews & Feedback" subtitle="Loading…">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm h-64 animate-pulse" />
          <div className="lg:col-span-2 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm h-24 animate-pulse" />
            ))}
          </div>
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="Reviews & Feedback" subtitle={`${visible.length} shown${hiddenCount ? ` · ${hiddenCount} hidden` : ''}`}>
      {error && (
        <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">Couldn't load reviews: {error}</div>
      )}

      {reviews.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <FiStar size={32} className="mx-auto text-gray-200 mb-3" />
          <h2 className="font-display font-semibold text-ink-900 mb-1">No reviews yet</h2>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Customers can rate an order from its tracking page once it's marked delivered.
            Reviews will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          {/* summary */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center lg:text-left">
            <div className="text-5xl font-bold text-ink-900">{avg}</div>
            <div className="flex justify-center lg:justify-start gap-0.5 my-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <FiStar key={i} size={18} className={i < Math.round(avg) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'} />
              ))}
            </div>
            <div className="text-sm text-gray-400 mb-4">Average rating</div>
            <div className="space-y-1.5">
              {dist.map((d) => (
                <div key={d.r} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 w-3">{d.r}</span>
                  <FiStar size={11} className="fill-yellow-400 text-yellow-400" />
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${(d.count / max) * 100}%` }} />
                  </div>
                  <span className="text-gray-400 w-4 text-right">{d.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* list */}
          <div className="lg:col-span-2 space-y-3">
            {reviews.map((f) => (
              <div key={f.id} className={`bg-white rounded-2xl border shadow-sm p-5 transition-opacity ${f.hidden ? 'border-gray-200 opacity-60' : 'border-gray-100'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-full bg-secondary-500 text-white text-sm font-bold flex items-center justify-center shrink-0">{f.name.charAt(0).toUpperCase()}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-ink-900 text-sm truncate flex items-center gap-2">
                        {f.name}
                        {f.hidden && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">Hidden</span>}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        <Link to="/admin/orders" className="hover:underline">Order #{f.orderId}</Link>
                        {f.products.length > 0 && <> · {f.products.join(', ')}</>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, s) => (
                        <FiStar key={s} size={13} className={s < f.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'} />
                      ))}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-1">{fmtDate(f.date)}</div>
                  </div>
                </div>
                {f.comment && <p className="text-sm text-gray-600 mt-3 leading-relaxed">"{f.comment}"</p>}
                <div className="mt-3 pt-3 border-t border-gray-50 flex justify-end">
                  <button
                    onClick={() => toggleHidden(f)}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                      f.hidden ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {f.hidden ? <><FiEye size={13} /> Show</> : <><FiEyeOff size={13} /> Hide</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
