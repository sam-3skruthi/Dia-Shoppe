import { supabase } from './supabase'

/*
  Instagram / Facebook management. Connection state + the social inbox
  (comments & DMs a Meta webhook forwards) live in Supabase; replies post back
  through the social-reply Edge Function. Everything is admin-gated by RLS.

  Live data requires the Meta app to be verified and the Page / IG business
  account connected — until then fetchSocialInbox() simply returns [].
*/

export async function fetchSocialStatus() {
  const { data, error } = await supabase
    .from('social_accounts')
    .select('platform, connected, account_name, connected_at')
  if (error) return { accounts: {}, error: error.message }
  const accounts = Object.fromEntries((data || []).map((a) => [a.platform, a]))
  return { accounts, error: null }
}

export async function fetchSocialInbox(platform = 'all') {
  let q = supabase
    .from('social_messages')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(200)
  if (platform !== 'all') q = q.eq('platform', platform)
  const { data, error } = await q
  return { messages: data || [], error: error?.message || null }
}

/** Post a reply to a comment/DM via the social-reply Edge Function. */
export async function replyToSocial(messageId, text) {
  const { data, error } = await supabase.functions.invoke('social-reply', {
    body: { message_id: messageId, text },
  })
  if (error) return { error: error.message }
  return { result: data }
}

/**
 * Begins the Meta OAuth connect flow for a platform. Requires the Meta app to
 * be live + a configured redirect; returns the URL the admin should open.
 * Until the app is approved this is a documented placeholder.
 */
export function connectUrl(platform) {
  const appId = import.meta.env.VITE_META_APP_ID
  if (!appId) return null
  const redirect = encodeURIComponent(`${location.origin}/admin/social`)
  const scope = platform === 'instagram'
    ? 'instagram_basic,instagram_manage_comments,instagram_manage_messages,pages_show_list'
    : 'pages_manage_engagement,pages_read_engagement,pages_messaging,pages_show_list'
  return `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirect}&scope=${scope}&state=${platform}`
}
