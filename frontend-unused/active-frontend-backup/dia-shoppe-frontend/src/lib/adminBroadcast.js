import { supabase } from './supabase'

/*
  WhatsApp broadcast — a marketing message to every customer who opted in.
  Consent is mandatory (Meta rule): the audience is only user_profiles with
  whatsapp_marketing_opt_in = true AND a phone number. The actual send runs
  server-side in the whatsapp-broadcast Edge Function, which re-checks consent
  and logs each message.
*/

/** How many customers a broadcast would reach right now. */
export async function fetchAudience() {
  const { count, error } = await supabase
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('whatsapp_marketing_opt_in', true)
    .not('phone', 'is', null)
  return { count: count || 0, error: error?.message || null }
}

/** Recent broadcast sends, newest first (from the message log). */
export async function fetchBroadcastHistory() {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('id, phone_number, message_text, sent_at, message_type')
    .eq('message_type', 'broadcast')
    .order('sent_at', { ascending: false })
    .limit(200)
  if (error) return { sends: [], error: error.message }
  return { sends: data || [], error: null }
}

/**
 * Fires the broadcast. `message` may contain {{name}}, replaced per-recipient.
 * `imageUrl` (optional) attaches an image/poster to the message.
 * Returns { audience, sent, failed } counts from the Edge Function.
 */
export async function sendBroadcast(message, imageUrl = null) {
  const { data, error } = await supabase.functions.invoke('whatsapp-broadcast', {
    body: { message, imageUrl },
  })
  if (error) return { error: error.message }
  return { result: data }
}
