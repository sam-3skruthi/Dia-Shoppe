import { supabase } from './supabase'

/*
  WhatsApp marketing — canonical template-based campaign lifecycle (Meta-compliant).
  Free-text blasts are intentionally NOT supported. The flow is:
    wa_create_campaign  ->  whatsapp-campaign (AI copy SUGGESTIONS)  ->  wa_set_campaign_variables  ->  wa_approve_campaign
  Consent and the recipient audience are resolved server-side at approval (whitelisted filter JOINed with marketing consent).
  All RPCs/functions re-check is_admin() on the server; this lib never bypasses that.
*/

const msg = (e) => e?.message || (e ? String(e) : null)

/** Registered MARKETING templates. `approved && enabled` ones are runnable now; others await Meta approval. */
export async function fetchMarketingTemplates() {
  const { data, error } = await supabase
    .from('whatsapp_templates')
    .select('name, language, category, status, enabled, header_type, body_params, param_schema')
    .eq('category', 'marketing')
    .order('name')
  if (error) return { templates: [], error: msg(error) }
  return { templates: data || [], error: null }
}

/** Rough reachable audience (opted-in customers). The authoritative, consent-joined set is resolved at approval. */
export async function fetchAudiencePreview() {
  const { count, error } = await supabase
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('whatsapp_marketing_opt_in', true)
    .not('phone', 'is', null)
  return { count: count || 0, error: msg(error) }
}

/** Recent campaigns with status + delivery visibility. */
export async function fetchCampaigns() {
  const { data, error } = await supabase
    .from('whatsapp_campaigns')
    .select('id, name, template_name, template_language, status, recipients_count, created_at, approved_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return { campaigns: [], error: msg(error) }
  return { campaigns: data || [], error: null }
}

/** Create a draft campaign bound to an approved marketing template. Returns the campaign id. */
export async function createCampaign({ name, template, language, audience, imageUrl = null }) {
  const { data, error } = await supabase.rpc('wa_create_campaign', {
    p_name: name,
    p_template: template,
    p_language: language,
    p_audience: audience,
    p_image_url: imageUrl,
  })
  if (error) return { error: msg(error) }
  return { campaignId: data, error: null }
}

/** AI copy SUGGESTIONS for one static template variable (the model never sees customer data and never sends). */
export async function suggestCopy({ campaignId, brief, variable }) {
  const { data, error } = await supabase.functions.invoke('whatsapp-campaign', {
    body: { action: 'generate_copy', campaign_id: campaignId, brief, variable },
  })
  if (error) return { suggestions: [], error: msg(error) }
  const { data: c } = await supabase.from('whatsapp_campaigns').select('ai_copy').eq('id', campaignId).maybeSingle()
  return { suggestions: c?.ai_copy?.suggestions || data?.suggestions || [], error: null }
}

/** Admin writes the final static variable values (the human approval of the CONTENT). Moves status -> copy_ready. */
export async function setVariables({ campaignId, variables }) {
  const { error } = await supabase.rpc('wa_set_campaign_variables', { p_id: campaignId, p_variables: variables })
  return { error: msg(error) }
}

/** A logged-in admin approves: resolves the consenting audience and queues one message per recipient. Returns count. */
export async function approveCampaign(campaignId) {
  const { data, error } = await supabase.rpc('wa_approve_campaign', { p_id: campaignId })
  if (error) return { error: msg(error) }
  return { recipients: data, error: null }
}

/** Cancel a campaign and skip any still-queued messages. Returns number of queued rows skipped. */
export async function cancelCampaign(campaignId) {
  const { data, error } = await supabase.rpc('wa_cancel_campaign', { p_id: campaignId })
  if (error) return { error: msg(error) }
  return { skipped: data, error: null }
}
