import posthog from 'posthog-js'

/*
  PostHog product analytics. The phc_ project key is publishable (like the
  Supabase anon key). Everything no-ops when the key is missing, so local
  setups without .env analytics keys keep working.

  Event naming: snake_case verbs — product_viewed, add_to_cart,
  checkout_started, order_placed. Server-side payment_success fires from the
  Edge Functions with the same distinct_id (the Supabase user id), so funnels
  can stitch client + server events together.
*/

const KEY = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'

export const analyticsEnabled = Boolean(KEY)

if (analyticsEnabled) {
  posthog.init(KEY, {
    api_host: HOST,
    // SPA — we capture pageviews ourselves on route change (see App.jsx)
    capture_pageview: false,
    autocapture: true,
    persistence: 'localStorage+cookie',
  })
}

export function trackPageview() {
  if (analyticsEnabled) posthog.capture('$pageview')
}

export function track(event, properties) {
  if (analyticsEnabled) posthog.capture(event, properties)
}

/** Ties this browser's events to the logged-in Supabase user. */
export function identifyUser(user) {
  if (analyticsEnabled && user) {
    posthog.identify(user.id, { email: user.email, name: user.name, role: user.role })
  }
}

/** Back to an anonymous visitor (on logout). */
export function resetAnalytics() {
  if (analyticsEnabled) posthog.reset()
}
