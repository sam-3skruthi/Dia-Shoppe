import { supabase } from './supabase'

/*
  Global site settings (site_settings table). Currently just the manual
  "sale theme" override — an admin switch that forces the storefront's sale
  design on, independent of whether a sale event is running.
*/

const SALE_KEY = 'sale_theme_forced'

/** Is the sale theme manually forced on by an admin? (public read) */
export async function fetchSaleThemeForced() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', SALE_KEY)
    .maybeSingle()
  if (error) return false
  return data?.value === true
}

/** Admin-only: force the sale theme on/off (RLS enforces admin). */
export async function setSaleThemeForced(on) {
  const { error } = await supabase
    .from('site_settings')
    .update({ value: on, updated_at: new Date().toISOString() })
    .eq('key', SALE_KEY)
  return { error: error?.message || null }
}

/* ── Editable message wording ──────────────────────────────────
   The owner can tweak these from Admin → Settings without touching code or
   Meta. The WhatsApp Edge Functions read these live (with the same defaults as
   fallbacks), so changes take effect immediately.

   Note: these are the FILL-IN parts of the messages, not the fixed Meta
   template skeleton (which still needs Meta approval to change). */
const MESSAGES_KEY = 'message_settings'

export const DEFAULT_MESSAGES = {
  status_confirmed: 'We are preparing it for dispatch.',
  status_shipped: 'It is on the way!',
  status_delivered: 'We hope everything arrived in perfect condition.',
  status_cancelled: 'If you were charged, the amount will be refunded.',
  ai_instructions:
    "Only discuss Dia Shoppe store topics (products, orders, delivery). Reply in the customer's language. Never give medical advice. Politely escalate returns, refunds, or anything you're unsure about to a human.",
  cart_reminder:
    "Complete your order before it sells out — we're here if you need any help!",
  broadcast_default: '',
}

/** Current message wording, defaults merged under any saved overrides. */
export async function fetchMessageSettings() {
  const { data } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', MESSAGES_KEY)
    .maybeSingle()
  return { ...DEFAULT_MESSAGES, ...(data?.value || {}) }
}

/** Admin-only: save message wording (creates the row if missing). */
export async function saveMessageSettings(obj) {
  const { error } = await supabase
    .from('site_settings')
    .upsert({ key: MESSAGES_KEY, value: obj, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return { error: error?.message || null }
}
