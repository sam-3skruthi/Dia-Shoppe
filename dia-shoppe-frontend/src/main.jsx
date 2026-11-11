import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/caveat/700.css'
import './index.css'
import App from './App.jsx'
import { initSentry, Sentry } from './lib/sentry'

initSentry()

// Sentry's error boundary shows a friendly fallback (and reports the error)
// if a render crash ever happens in production; in dev it re-throws so you
// still see the overlay.
function Fallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#021225' }}>Something went wrong</h1>
        <p style={{ marginTop: 8, color: '#0B2A44' }}>Please refresh the page. Our team has been notified.</p>
        <button onClick={() => window.location.assign('/')} style={{ marginTop: 16, background: '#238689', color: '#fff', border: 0, borderRadius: 999, padding: '10px 20px', fontWeight: 600, cursor: 'pointer' }}>
          Back to home
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<Fallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
