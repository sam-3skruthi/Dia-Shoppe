import { useEffect, useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout'
import {
  fetchMarketingTemplates, fetchAudiencePreview, fetchCampaigns,
  createCampaign, suggestCopy, setVariables, approveCampaign, cancelCampaign,
} from '../../lib/adminBroadcast'
import { uploadProductImage } from '../../lib/adminCatalog'
import {
  FiSend, FiUsers, FiInfo, FiCheckCircle, FiAlertTriangle, FiClock,
  FiImage, FiX, FiZap,
} from 'react-icons/fi'

/*
  WhatsApp marketing campaigns — the canonical, Meta-compliant template lifecycle:
    pick an APPROVED marketing template -> create draft (name + audience + optional image)
    -> fill the template's static variable(s) (optionally AI-suggested) -> approve (a logged-in
    admin) -> the server resolves the consenting audience and queues one templated message each.
  Free-text blasts are intentionally not offered. Consent + recipients are resolved server-side.
*/

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  copy_ready: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-600',
}

export default function AdminBroadcast() {
  const [templates, setTemplates] = useState([])
  const [audience, setAudience] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [error, setError] = useState(null)

  // compose state
  const [templateKey, setTemplateKey] = useState('')
  const [name, setName] = useState('')
  const [segment, setSegment] = useState('all_opted_in')
  const [limit, setLimit] = useState(1000)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)

  // lifecycle state
  const [campaignId, setCampaignId] = useState(null)
  const [variables, setVars] = useState({})
  const [aiBrief, setAiBrief] = useState('')
  const [aiBusy, setAiBusy] = useState(null)
  const [suggestions, setSuggestions] = useState({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'approved' && t.enabled),
    [templates],
  )
  const selected = useMemo(
    () => approvedTemplates.find((t) => `${t.name}::${t.language}` === templateKey) || null,
    [approvedTemplates, templateKey],
  )
  const staticVars = useMemo(
    () => (selected?.param_schema || []).filter((p) => p.kind === 'static'),
    [selected],
  )
  const needsImage = selected?.header_type === 'image'

  const refreshCampaigns = () => fetchCampaigns().then((r) => { if (!r.error) setCampaigns(r.campaigns) })

  useEffect(() => {
    fetchMarketingTemplates().then((r) => { if (r.error) setError(r.error); else setTemplates(r.templates) })
    fetchAudiencePreview().then((r) => { if (!r.error) setAudience(r.count) })
    refreshCampaigns()
  }, [])

  const audienceSpec = () => {
    const spec = { segment, limit: Math.min(Number(limit) || 1000, 1000) }
    return spec
  }

  const pickImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }
  const clearImage = () => { setImageFile(null); setImagePreview(null) }

  const resetCompose = () => {
    setCampaignId(null); setVars({}); setSuggestions({}); setAiBrief('')
    setName(''); setTemplateKey(''); clearImage()
  }

  // Step 1 — create the draft campaign
  const doCreateDraft = async () => {
    if (!selected || !name.trim()) return
    setBusy(true); setError(null); setResult(null)
    let imageUrl = null
    if (needsImage) {
      if (!imageFile) { setError('This template has an image header — please add a poster image.'); setBusy(false); return }
      const up = await uploadProductImage(imageFile)
      if (up.error) { setError(`Image upload failed: ${up.error}`); setBusy(false); return }
      imageUrl = up.url
    }
    const { campaignId: id, error: err } = await createCampaign({
      name: name.trim(), template: selected.name, language: selected.language, audience: audienceSpec(), imageUrl,
    })
    setBusy(false)
    if (err) { setError(err); return }
    setCampaignId(id)
  }

  // AI copy suggestion for one static variable
  const doSuggest = async (variable) => {
    if (!campaignId || !aiBrief.trim()) return
    setAiBusy(variable); setError(null)
    const { suggestions: s, error: err } = await suggestCopy({ campaignId, brief: aiBrief.trim(), variable })
    setAiBusy(null)
    if (err) { setError(err); return }
    setSuggestions((prev) => ({ ...prev, [variable]: s }))
  }

  // Step 2 — save variable content (copy_ready)
  const doSaveCopy = async () => {
    for (const v of staticVars) {
      if (!String(variables[v.name] || '').trim()) { setError(`Variable "${v.name}" is required.`); return }
    }
    setBusy(true); setError(null)
    const { error: err } = await setVariables({ campaignId, variables })
    setBusy(false)
    if (err) { setError(err); return }
    setError('saved')  // soft marker; overwritten by approve
    setError(null)
    refreshCampaigns()
  }

  // Step 3 — approve & queue
  const doApprove = async () => {
    setBusy(true); setError(null)
    // ensure copy is saved first
    const save = await setVariables({ campaignId, variables })
    if (save.error) { setBusy(false); setError(save.error); return }
    const { recipients, error: err } = await approveCampaign(campaignId)
    setBusy(false)
    if (err) { setError(err); return }
    setResult({ recipients })
    refreshCampaigns()
    resetCompose()
  }

  const doCancel = async () => {
    if (!campaignId) { resetCompose(); return }
    setBusy(true)
    await cancelCampaign(campaignId)
    setBusy(false)
    resetCompose(); refreshCampaigns()
  }

  const firstStaticPreview = staticVars[0] ? (variables[staticVars[0].name] || '') : ''

  return (
    <AdminLayout title="Campaigns" subtitle="Send a Meta-approved WhatsApp template to opted-in customers">
      {error && error !== 'saved' && <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm mb-4" role="alert">{error}</div>}
      {result && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-sm text-emerald-800 flex items-start gap-2 mb-4">
          <FiCheckCircle className="mt-0.5 shrink-0" />
          <span>Campaign approved — <b>{result.recipients}</b> consenting recipient{result.recipients === 1 ? '' : 's'} queued. Delivery runs through the WhatsApp worker.</span>
        </div>
      )}

      {approvedTemplates.length === 0 ? (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 text-sm text-amber-800 flex items-start gap-3">
          <FiAlertTriangle className="mt-0.5 shrink-0" size={18} />
          <div>
            <p className="font-semibold">No approved marketing template yet.</p>
            <p className="mt-1">Marketing campaigns require a Meta-approved, enabled <b>marketing</b> template. This is an external dependency: submit a template in Meta Business Manager and sync it (Admin → WhatsApp → Sync templates). Registered templates and their status:</p>
            <ul className="mt-2 space-y-1">
              {templates.length === 0 && <li className="text-amber-700">· none registered</li>}
              {templates.map((t) => (
                <li key={`${t.name}::${t.language}`} className="text-amber-700">· <b>{t.name}</b> ({t.language}) — {t.status}{t.enabled ? '' : ', disabled'}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-ink-900">New campaign</h2>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-600 bg-secondary-50 px-3 py-1 rounded-full">
                <FiUsers size={14} /> ~{audience === null ? '…' : audience} opted-in
              </span>
            </div>

            {/* template + name */}
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Approved marketing template</span>
                <select value={templateKey} onChange={(e) => { setTemplateKey(e.target.value); setCampaignId(null); setVars({}); setSuggestions({}) }}
                  disabled={!!campaignId}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300 disabled:bg-gray-50">
                  <option value="">Select a template…</option>
                  {approvedTemplates.map((t) => (
                    <option key={`${t.name}::${t.language}`} value={`${t.name}::${t.language}`}>{t.name} ({t.language})</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Campaign name (internal)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} disabled={!!campaignId} maxLength={120}
                  placeholder="e.g. Diwali sale — glucometers"
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300 disabled:bg-gray-50" />
              </label>
            </div>

            {/* audience */}
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Audience segment</span>
                <select value={segment} onChange={(e) => setSegment(e.target.value)} disabled={!!campaignId}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300 disabled:bg-gray-50">
                  <option value="all_opted_in">All opted-in customers</option>
                  <option value="past_customers">Past customers (opted-in)</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Max recipients (cap 1000)</span>
                <input type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} disabled={!!campaignId}
                  className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300 disabled:bg-gray-50" />
              </label>
            </div>

            {/* image if the template has an image header */}
            {needsImage && (
              <div className="mt-4">
                {imagePreview ? (
                  <div className="relative inline-block">
                    <img src={imagePreview} alt="Poster" className="max-h-40 rounded-xl border border-gray-200" />
                    {!campaignId && (
                      <button onClick={clearImage} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center text-gray-500 hover:text-red-500" aria-label="Remove image">
                        <FiX size={14} />
                      </button>
                    )}
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700 cursor-pointer hover:underline">
                    <FiImage size={16} /> Add the template's header image <span className="text-gray-400 font-normal">(required)</span>
                    <input type="file" accept="image/*" onChange={pickImage} className="hidden" />
                  </label>
                )}
              </div>
            )}

            {!campaignId ? (
              <button onClick={doCreateDraft} disabled={!selected || !name.trim() || busy}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-primary-700 text-white font-semibold px-6 py-3 rounded-full hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed">
                {busy ? 'Creating…' : 'Create draft campaign'}
              </button>
            ) : (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <h3 className="font-display font-semibold text-ink-900 mb-1">Template content</h3>
                <p className="text-xs text-gray-400 mb-3">Each recipient is greeted by their first name automatically. Fill the remaining variable{staticVars.length === 1 ? '' : 's'} below.</p>

                {/* AI brief */}
                <label className="block mb-3">
                  <span className="text-xs font-medium text-gray-500">AI copy brief (optional)</span>
                  <input value={aiBrief} onChange={(e) => setAiBrief(e.target.value)}
                    placeholder="e.g. 20% off BP monitors this week, warm and short"
                    className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300" />
                </label>

                {staticVars.length === 0 && <p className="text-sm text-gray-400">This template has no free-text variable.</p>}
                {staticVars.map((v) => (
                  <div key={v.name} className="mb-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-500">{v.name} <span className="text-gray-300">(max {v.max})</span></span>
                      <button onClick={() => doSuggest(v.name)} disabled={!aiBrief.trim() || aiBusy === v.name}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-secondary-600 hover:underline disabled:opacity-40">
                        <FiZap size={12} /> {aiBusy === v.name ? 'Thinking…' : 'Suggest with AI'}
                      </button>
                    </div>
                    <textarea rows={2} maxLength={v.max} value={variables[v.name] || ''}
                      onChange={(e) => setVars((p) => ({ ...p, [v.name]: e.target.value }))}
                      className="mt-1 w-full border border-primary-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300 resize-none" />
                    {(suggestions[v.name] || []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {suggestions[v.name].map((s, i) => (
                          <button key={i} onClick={() => setVars((p) => ({ ...p, [v.name]: s }))}
                            className="text-xs text-left px-2.5 py-1 rounded-lg bg-secondary-50 border border-secondary-100 text-secondary-700 hover:bg-secondary-100">{s}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex gap-2 mt-4">
                  <button onClick={doApprove} disabled={busy}
                    className="inline-flex items-center justify-center gap-2 bg-primary-700 text-white font-semibold px-6 py-2.5 rounded-full hover:bg-primary-800 disabled:opacity-50">
                    <FiSend size={16} /> {busy ? 'Approving…' : 'Approve & queue'}
                  </button>
                  <button onClick={doCancel} disabled={busy} className="px-4 py-2.5 rounded-full text-sm font-semibold text-gray-600 hover:bg-gray-100">Discard</button>
                </div>
              </div>
            )}
          </div>

          {/* campaigns list */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-display font-semibold text-ink-900 mb-3">Recent campaigns</h2>
            {campaigns.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No campaigns yet.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {campaigns.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 text-sm border-b border-gray-50 last:border-0 pb-2">
                    <FiClock size={13} className="text-gray-300 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-gray-700 truncate">{c.name} <span className="text-gray-400">· {c.template_name} ({c.template_language})</span></div>
                      <div className="text-[11px] text-gray-400">{new Date(c.created_at).toLocaleString('en-IN')}{c.recipients_count != null ? ` · ${c.recipients_count} queued` : ''}</div>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-600'}`}>{c.status}</span>
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
            <div className="rounded-2xl bg-[#CAF0F8] p-3 min-h-[120px]">
              <div className="bg-white rounded-lg rounded-tr-none p-1.5 shadow-sm max-w-[90%] ml-auto">
                {imagePreview && <img src={imagePreview} alt="" className="rounded-md mb-1.5 w-full object-cover max-h-40" />}
                <div className="px-1.5 py-1 text-sm text-gray-800 whitespace-pre-wrap">
                  {firstStaticPreview ? <>Hi Ramesh! {firstStaticPreview}</> : <span className="text-gray-400">Template message appears here…</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-sm text-gray-600 space-y-3">
            <h2 className="font-display font-semibold text-ink-900 flex items-center gap-2"><FiInfo size={15} className="text-secondary-500" /> How campaigns work</h2>
            <p className="flex gap-2"><FiCheckCircle size={15} className="text-emerald-500 shrink-0 mt-0.5" /> Only Meta-approved marketing templates can be sent — free-text blasts are not allowed.</p>
            <p className="flex gap-2"><FiCheckCircle size={15} className="text-emerald-500 shrink-0 mt-0.5" /> Recipients are only customers who granted WhatsApp marketing consent; the server resolves and re-checks this at approval.</p>
            <p className="flex gap-2"><FiInfo size={15} className="text-gray-400 shrink-0 mt-0.5" /> Meta charges per marketing message — use campaigns sparingly.</p>
          </div>
        </div>
      </div>
      )}
    </AdminLayout>
  )
}
