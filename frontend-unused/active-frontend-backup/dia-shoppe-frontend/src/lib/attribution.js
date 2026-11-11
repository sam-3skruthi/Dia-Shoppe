/*
  First-touch acquisition tracking — "where did this customer find us?".

  On the very first visit we read the referrer + any UTM parameters, classify
  them into a channel (Instagram / Facebook / Google / WhatsApp / …), and store
  it in localStorage so it survives the whole journey to checkout. When an order
  is placed we attach this source to the order, so the admin dashboard can show
  which channels actually drive SALES (exact, from the database).

  All-visitor traffic (including people who never buy) still lives in PostHog —
  this is the buyer-attribution half that the dashboard owns natively.
*/
const KEY = 'diashoppe_src'

const CHANNELS = [
  { channel: 'Instagram', test: (r, s) => /instagram\.com|l\.instagram|ig\.me/.test(r) || /^(ig|insta|instagram)$/i.test(s) },
  { channel: 'Facebook', test: (r, s) => /facebook\.com|fb\.com|l\.facebook|m\.facebook|fb\.me/.test(r) || /^(fb|facebook|meta)$/i.test(s) },
  { channel: 'WhatsApp', test: (r, s) => /whatsapp\.com|wa\.me/.test(r) || /^(wa|whatsapp)$/i.test(s) },
  { channel: 'Google', test: (r, s) => /google\.|bing\.|duckduckgo\.|yahoo\./.test(r) || /^(google|bing|search|cpc|adwords|google-ads)$/i.test(s) },
  { channel: 'YouTube', test: (r, s) => /youtube\.com|youtu\.be/.test(r) || /^(yt|youtube)$/i.test(s) },
]

function classify(referrer, utmSource) {
  const r = (referrer || '').toLowerCase()
  const s = (utmSource || '').toLowerCase()
  for (const c of CHANNELS) if (c.test(r, s)) return c.channel
  if (s) return s.charAt(0).toUpperCase() + s.slice(1) // named campaign we didn't map
  if (r) {
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, '')
      if (host && !host.includes(location.hostname)) return host // some other site linked us
    } catch { /* ignore malformed referrer */ }
  }
  return 'Direct' // typed the URL, bookmark, or app with no referrer
}

/** Capture first-touch source once, on the first page the visitor lands on. */
export function captureFirstTouch() {
  try {
    if (localStorage.getItem(KEY)) return // already captured — first touch wins
    const params = new URLSearchParams(location.search)
    const utmSource = params.get('utm_source')
    const channel = classify(document.referrer, utmSource)
    const record = {
      channel,
      detail: utmSource || (document.referrer ? 'referral' : 'direct'),
      campaign: params.get('utm_campaign') || null,
      landing: location.pathname,
      at: new Date().toISOString(),
    }
    localStorage.setItem(KEY, JSON.stringify(record))
  } catch { /* private mode / storage blocked — attribution is best-effort */ }
}

/** The stored first-touch source, or a Direct fallback. */
export function getFirstTouch() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { channel: 'Direct', detail: 'direct', campaign: null }
}
