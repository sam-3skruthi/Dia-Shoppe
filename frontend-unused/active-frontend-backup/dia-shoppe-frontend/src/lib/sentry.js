import * as Sentry from '@sentry/react'

/*
  Error monitoring. No-ops without VITE_SENTRY_DSN so local/dev runs stay quiet;
  once the DSN is set (create a free project at sentry.io), runtime errors and
  performance data flow to the Sentry dashboard and the owner/maintainer gets
  alerted when the site breaks in production.
*/
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // capture 10% of transactions for performance; errors are always captured
    tracesSampleRate: 0.1,
    integrations: [Sentry.browserTracingIntegration()],
    // don't spam Sentry with noise from browser extensions / network blips
    ignoreErrors: ['Non-Error promise rejection captured', 'ResizeObserver loop'],
  })
}

// Attach the logged-in user to errors so issues are traceable to an account.
export function setSentryUser(user) {
  if (!import.meta.env.VITE_SENTRY_DSN) return
  if (user) Sentry.setUser({ id: user.id, email: user.email })
  else Sentry.setUser(null)
}

export { Sentry }
