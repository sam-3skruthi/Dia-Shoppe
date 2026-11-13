/*
  Once-per-browser-session gate for the homepage loading animation.

  - Plays on the first homepage entry of a browser session only.
  - Never replays on internal navigation or on refresh in the same session
    (the flag is written as soon as the loader starts, not when it ends).
  - Skipped for in-page deep links (e.g. /#about) so anchors aren't delayed.
  - `?loader=replay` forces a replay (for design review / QA).
  - Any storage failure (private mode, blocked storage) → the loader is skipped
    rather than shown on every page view.
*/
const KEY = 'dia.loader.seen'

export function shouldPlayLoader() {
  try {
    if (typeof window === 'undefined') return false
    if (new URLSearchParams(window.location.search).get('loader') === 'replay') return true
    if (window.location.hash) return false
    return window.sessionStorage.getItem(KEY) !== '1'
  } catch {
    return false
  }
}

export function markLoaderSeen() {
  try {
    window.sessionStorage.setItem(KEY, '1')
  } catch {
    /* storage unavailable — shouldPlayLoader() already fails closed */
  }
}
