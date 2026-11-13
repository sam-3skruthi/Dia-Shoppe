import { useEffect, useRef } from 'react'
import { markLoaderSeen } from '../../lib/loaderSession'

/*
  Homepage loading animation — glass shards re-forming into the D + S monogram.

  Shows the SAME monogram as the site-wide backdrop (src/lib/dsMonogram.js:
  script chrome, D above, S hanging from its base), in the same place on
  screen, so when the veil lifts the page's own monogram continues seamlessly.

  Sequence: the Dolphin Dive aurora fades in → ~1,400 faceted glass shards
  fly in from all around and settle onto the real surface of the letters (top
  of the D first, down through the S), melting in as they land while the solid
  chrome monogram forms behind them → it holds for a moment → the veil lifts
  upward to reveal the page.

  Mounted by Home only when the once-per-session gate says so. Three.js
  (via dsMonogram) and GSAP are dynamic imports: neither is in the main bundle.
    • WebGL           — the sequence above
    • reduced motion  — the monogram simply appears, holds, then fades
    • no WebGL / slow — the aurora only, then a quick lift (never block the page)

  Any click / key press / Skip button fast-forwards to the lift. Scrolling is
  locked while the overlay is up. onReveal fires as the veil starts to lift;
  onDone fires when it is gone.
*/

const LOAD_TIMEOUT_MS = 3000          // never hold the page for slow assets
const MASK_SCALE = 0.5
const auroraCss =
  'radial-gradient(60% 50% at 18% 12%, rgba(144,224,239,.95), transparent 70%),' +
  'radial-gradient(50% 45% at 85% 20%, rgba(0,180,216,.22), transparent 70%),' +
  'radial-gradient(55% 45% at 70% 95%, rgba(0,180,216,.2), transparent 70%),' +
  'radial-gradient(40% 35% at 6% 92%, rgba(2,136,209,.08), transparent 70%)'

/* The reveal mask: everything the light has already passed is lit, with a
   soft leading edge. p = 0 → nothing, p = 1 → everything. The light travels
   diagonally from the top of the D to the tail of the S. */
function paintSweep(canvas, p) {
  const w = Math.max(1, Math.round(window.innerWidth * MASK_SCALE))
  const h = Math.max(1, Math.round(window.innerHeight * MASK_SCALE))
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, w, h)
  if (p <= 0) return
  const edge = 0.22                                   // softness of the leading edge (of the diagonal)
  const at = -edge + p * (1 + 2 * edge)               // edge position along the diagonal, 0..1
  // sweep across the monogram's own area (centre of the screen), not the whole
  // screen, so the letters are forming for the entire sweep
  const grad = g.createLinearGradient(w * 0.32, h * 0.08, w * 0.68, h * 0.92)
  const clamp = (v) => Math.min(1, Math.max(0, v))
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(clamp(at - edge / 2), 'rgba(0,0,0,1)')
  grad.addColorStop(clamp(at + edge / 2), 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
}

export default function DiaLoader({ onReveal, onDone }) {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const auroraRef = useRef(null)
  const cbRef = useRef({ onReveal, onDone })
  useEffect(() => { cbRef.current = { onReveal, onDone } })

  useEffect(() => {
    markLoaderSeen()
    const root = rootRef.current
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const html = document.documentElement
    const prevOverflow = html.style.overflow
    html.style.overflow = 'hidden'

    let cancelled = false
    let finished = false
    let revealed = false
    let tl = null
    let mono = null
    let gsapRef = null
    let removeInput = () => {}
    const mask = document.createElement('canvas')

    const reveal = () => {
      if (revealed) return
      revealed = true
      cbRef.current.onReveal?.()
    }
    const finish = () => {
      if (finished) return
      finished = true
      removeInput()
      html.style.overflow = prevOverflow
      mono?.dispose()
      mono = null
      cbRef.current.onDone?.()
    }

    const bindSkip = (g) => {
      const skip = () => {
        if (!tl || finished || tl.time() >= tl.labels.lift) return
        g.to(tl, { time: tl.labels.lift, duration: 0.55, ease: 'power2.inOut', overwrite: true })
      }
      const onKey = (e) => { if (['Escape', 'Enter', ' '].includes(e.key)) skip() }
      root.addEventListener('pointerdown', skip)
      window.addEventListener('keydown', onKey)
      removeInput = () => {
        root.removeEventListener('pointerdown', skip)
        window.removeEventListener('keydown', onKey)
      }
    }

    // the veil lifts upward (clip-path), revealing the page already rendered below
    const addLift = (t, liftAt, fade = false) => {
      t.addLabel('lift', liftAt)
      t.call(reveal, null, 'lift')
      if (fade) t.to(root, { opacity: 0, duration: 0.45 }, 'lift')
      else t.to(root, { clipPath: 'inset(0 0 100% 0)', duration: 0.95, ease: 'power3.inOut' }, 'lift')
      t.call(finish)
    }

    const run = async () => {
      let g
      try {
        g = (await import('gsap')).default
      } catch {
        reveal(); finish(); return
      }
      if (cancelled) return
      gsapRef = g
      bindSkip(g)

      // Probe for WebGL before downloading the 3D chunk.
      const hasWebGL = (() => {
        try {
          const c = document.createElement('canvas')
          const ctx = c.getContext('webgl2') || c.getContext('webgl')
          ctx?.getExtension('WEBGL_lose_context')?.loseContext()
          return Boolean(ctx)
        } catch { return false }
      })()
      if (hasWebGL) {
        const attempt = (async () => {
          const { createMonogramRenderer } = await import('../../lib/dsMonogram')
          return createMonogramRenderer(canvasRef.current, { shards: window.innerWidth < 768 ? 800 : 1400 })
        })()
        mono = await Promise.race([
          attempt.catch(() => null),
          new Promise((r) => setTimeout(() => r(null), LOAD_TIMEOUT_MS)),
        ])
        attempt.then((m) => { if (m && m !== mono) m.dispose() }).catch(() => {})
      }
      if (cancelled) { mono?.dispose(); mono = null; return }

      tl = g.timeline({ paused: true })
      tl.fromTo(auroraRef.current, { opacity: 0, xPercent: -8 }, { opacity: 1, xPercent: 0, duration: 1.4, ease: 'power2.out' }, 0)

      if (mono) {
        mono.setSize(window.innerWidth, window.innerHeight)
        const st = { p: reduced ? 1 : 0 }
        // the solid letters form just behind the arriving shards
        const solid = (p) => Math.min(1, Math.max(0, (p - 0.28) / 0.72))
        // (a final timeline update can land after finish() released the renderer)
        const draw = () => {
          if (!mono) return
          mono.setShards(st.p)
          paintSweep(mask, solid(st.p))
          mono.setMask(mask)
          mono.render()
        }
        tl.eventCallback('onUpdate', draw)
        tl.fromTo(canvasRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out' }, 0)
        if (reduced) {
          addLift(tl, 1.3, true)
        } else {
          // shards fly in and re-form the monogram
          tl.to(st, { p: 1, duration: 2.6, ease: 'power1.inOut' }, 0.35)
          addLift(tl, 3.6)
        }
        draw()
      } else {
        addLift(tl, reduced ? 0.8 : 1.4, reduced)      // no 3D: aurora only, quick
      }

      if (import.meta.env.DEV) {
        const freeze = new URLSearchParams(window.location.search).get('loaderT')
        if (freeze != null) { tl.time(parseFloat(freeze), false); return }   // dev-only: freeze a frame
      }
      tl.play()
    }
    run()

    return () => {
      cancelled = true
      tl?.kill()
      gsapRef?.killTweensOf(tl)
      removeInput()
      html.style.overflow = prevOverflow
      mono?.dispose()
      mono = null
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] overflow-hidden bg-dia-mint"
      style={{ clipPath: 'inset(0 0 0% 0)' }}
      role="status"
      aria-live="polite"
      aria-label="Loading Dia Shoppe"
    >
      <div ref={auroraRef} className="absolute inset-0 opacity-0" style={{ background: auroraCss }} aria-hidden="true" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-0" aria-hidden="true" />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) }}
        className="dia-label dia-glass absolute bottom-5 right-5 rounded-full px-4 py-2 transition-transform hover:scale-[1.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-dia-cyan"
      >
        Skip
      </button>
    </div>
  )
}
