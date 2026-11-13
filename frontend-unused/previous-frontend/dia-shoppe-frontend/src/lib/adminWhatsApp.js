import { supabase } from './supabase'

/*
  WhatsApp message log for the admin page. Rows are written by the
  whatsapp-notify Edge Function on every send attempt; the message_text
  prefix encodes the outcome:
    "[FAILED] …"              → Meta rejected the send
    "[hello_world fallback] …" → sent, but with the sandbox template
    anything else              → sent with the real order_update template
*/

const parseRow = (row) => {
  let outcome = 'sent'
  let text = row.message_text || ''
  if (text.startsWith('[FAILED]')) {
    outcome = 'failed'
    text = text.replace('[FAILED] ', '')
  } else if (text.startsWith('[hello_world fallback]')) {
    outcome = 'fallback'
    text = text.replace('[hello_world fallback] ', '')
  }
  return {
    id: row.id,
    orderId: row.order_id,
    type: (row.message_type || '').replace('order_', ''),
    phone: row.phone_number,
    direction: row.direction,
    text,
    outcome,
    at: row.sent_at,
  }
}

export async function fetchWhatsAppLog() {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('id, order_id, message_type, phone_number, message_text, direction, sent_at')
    .order('sent_at', { ascending: false })
    .limit(200)
  if (error) return { error: error.message, messages: [] }

  const messages = (data || []).map(parseRow)
  const sent = messages.filter((m) => m.outcome !== 'failed' && m.direction === 'outbound').length
  const failed = messages.filter((m) => m.outcome === 'failed').length
  return { messages, stats: { total: messages.length, sent, failed } }
}
