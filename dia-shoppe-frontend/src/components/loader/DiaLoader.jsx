import { useEffect, useRef } from 'react'
import { markLoaderSeen } from '../../lib/loaderSession'
import dMulM from '../../assets/dia/d-mul-m.webp'
import dAddM from '../../assets/dia/d-add-m.webp'
import sMulM from '../../assets/dia/s-mul-m.webp'
import sAddM from '../../assets/dia/s-add-m.webp'

/*
  Homepage loading animation — CRYSTAL FORMATION × AURORA REVEAL.

  Mounted by Home only when the once-per-session gate says so. This file is
  deliberately light: Three.js (glassScene) and GSAP are loaded with dynamic
  import(), so neither is in the main bundle and neither loads on later visits.

  Three presentations of the same sequence:
    • WebGL   — full 3D scene (default)
    • CSS     — same letters/aurora as layered images when WebGL is missing,
                too slow (software GL), fails, or the chunk is slow to load
    • static  — prefers-reduced-motion: a brief still composition + fade

  Any click / key press / Skip button fast-forwards to the lift. Scrolling is
  locked while the overlay is up. onReveal fires as the veil starts to lift
  (header brand + hero copy animate in); onDone fires when it is gone.
*/

const LOAD_TIMEOUT_MS = 3000          // never hold the page for slow assets
const mintCss = 'bg-dia-mint'
const auroraCss =
  'radial-gradient(60% 50% at 18% 12%, rgba(202,255,222,.95), transparent 70%),' +
  'radial-gradient(50% 45% at 85% 20%, rgba(37,197,233,.22), transparent 70%),' +
  'radial-gradient(55% 45% at 70% 95%, rgba(44,211,194,.2), transparent 70%),' +
  'radial-gradient(40% 35% at 6% 92%, rgba(107,91,214,.08), transparent 70%)'

export default function DiaLoader({ onReveal, onDone }) {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const cssRef = useRef(null)
  const cbRef = useRef({ onReveal, onDone })
  useEffect(() => { cbRef.current = { onReveal, onDone } })

  useEffect(() => {
    markLoaderSeen()
    const root = rootRef.current
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const mobile = window.innerWidth < 768
    const dev = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null
    const html = document.documentElement
    const prevOverflow = html.style.overflow
    html.style.overflow = 'hidden'

    let cancelled = false
    let finished = false
    let revealed = false
    let tl = null
    let scene = null
    let gsapRef = null
    let removeInput = () => {}

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
      scene?.dispose()
      scene = null
      cbRef.current.onDone?.()
    }

    // Shared tail of every timeline: once the D and S have held for a moment,
    // the veil lifts upward (clip-path), revealing the page already rendered below.
    // The loader shows ONLY the glass D and S: no wordmark, name or caption.
    const addLift = (t, g, liftAt) => {
      t.addLabel('lift', liftAt)
      t.call(reveal, null, 'lift')
      t.to(root, { clipPath: 'inset(0 0 100% 0)', duration: 0.95, ease: 'power3.inOut' }, 'lift')
      t.call(finish)
      return g
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

    const showCss = () => {
      canvasRef.current.style.display = 'none'
      cssRef.current.style.display = 'block'
    }

    const buildCssTimeline = (g) => {
      const q = (s) => cssRef.current.querySelectorAll(s)
      const aur = q('[data-aurora]')
      tl = g.timeline({ paused: true })
      if (reduced) {
        // no motion: letters simply appear, hold briefly, then the veil fades
        g.set([aur, q('[data-d]'), q('[data-s]')], { opacity: 1 })
        tl.fromTo(root, { opacity: 0.0 }, { opacity: 1, duration: 0.35 }, 0)
        tl.addLabel('lift', 1.3)
        tl.call(reveal, null, 'lift')
        tl.to(root, { opacity: 0, duration: 0.45 }, 'lift')
        tl.call(finish)
        return
      }
      tl.fromTo(aur, { opacity: 0, xPercent: -12 }, { opacity: 1, xPercent: 0, duration: 1.6, ease: 'power2.out' }, 0)
      tl.fromTo(q('[data-d]'), { opacity: 0, y: 46, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 1.3, ease: 'power3.out' }, 0.45)
      tl.fromTo(q('[data-s]'), { opacity: 0, y: -46, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 1.3, ease: 'power3.out' }, 0.8)
      // the letters glow softly as the light passes
      tl.to(q('img[style*="screen"]'), { filter: 'brightness(0.36)', duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 1.9)
      addLift(tl, g, 3.0)
    }

    const buildWebglTimeline = (g, sc) => {
      const st = { time: 0, aurora: 0, formD: 0, formS: 0, cam: 0, sweep: -0.5, join: 0, glow: 0 }
      const draw = () => { st.time = tl.time(); sc.draw(st) }
      tl = g.timeline({ paused: true, onUpdate: draw })
      tl.to(st, { aurora: 1, duration: 2.8, ease: 'power2.inOut' }, 0)
      tl.to(st, { formD: 1, duration: 2.0, ease: 'power1.inOut' }, 0.55)
      tl.to(st, { formS: 1, duration: 2.0, ease: 'power1.inOut' }, 0.95)
      tl.to(st, { cam: 1, duration: 3.1, ease: 'power3.inOut' }, 0.2)
      tl.to(st, { join: 1, duration: 1.7, ease: 'power2.inOut' }, 1.9)   // D and S drift together
      tl.to(st, { sweep: 1.45, duration: 1.5, ease: 'power1.inOut' }, 2.3)
      // soft glow on the D and S while the light streak crosses them, easing to a gentle afterglow
      tl.to(st, { glow: 1, duration: 0.9, ease: 'sine.inOut' }, 2.35)
      tl.to(st, { glow: 0.3, duration: 1.3, ease: 'sine.inOut' }, 3.3)
      tl.fromTo(canvasRef.current, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power1.out' }, 0)
      addLift(tl, g, 4.0)   // D + S hold briefly after the light sweep, then lift
      draw()
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

      // Probe for WebGL first: devices without it skip the 3D chunk entirely
      // (no download, no console noise) and go straight to the CSS version.
      const hasWebGL = (() => {
        try {
          const c = document.createElement('canvas')
          const ctx = c.getContext('webgl2') || c.getContext('webgl')
          ctx?.getExtension('WEBGL_lose_context')?.loseContext()
          return Boolean(ctx)
        } catch { return false }
      })()
      let gl = null
      if (!reduced && hasWebGL) {
        const attempt = (async () => {
          const { createGlassScene } = await import('./glassScene')
          return createGlassScene({
            canvas: canvasRef.current, mobile,
            forceGL: Boolean(dev && dev.get('forcegl')),
          })
        })()
        gl = await Promise.race([
          attempt.catch(() => null),
          new Promise((r) => setTimeout(() => r(null), LOAD_TIMEOUT_MS)),
        ])
        // if the scene arrives after the timeout, release it
        attempt.then((s) => { if (s && s !== gl) s.dispose() }).catch(() => {})
      }
      if (cancelled) { gl?.dispose(); return }

      if (gl) {
        scene = gl
        canvasRef.current.addEventListener('dia-gl-lost', () => { if (tl && !finished) { reveal(); tl.progress(1) } })
        buildWebglTimeline(g, gl)
      } else {
        showCss()
        buildCssTimeline(g)
      }

      const freeze = dev?.get('loaderT')
      if (freeze != null) {
        tl.time(parseFloat(freeze), false)    // dev-only: freeze on a frame for review
        window.__diaSeek = (t) => { tl.time(t, false) }   // dev-only: frame-accurate capture
        return
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
      scene?.dispose()
      scene = null
    }
  }, [])


  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[100] overflow-hidden ${mintCss}`}
      style={{ clipPath: 'inset(0 0 0% 0)' }}
      role="status"
      aria-live="polite"
      aria-label="Loading Dia Shoppe"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-0" aria-hidden="true" />

      {/* CSS presentation (no WebGL / reduced motion): same assets, layered.
          mul layers multiply onto the aurora, add layers screen on top. */}
      <div ref={cssRef} className="absolute inset-0 bg-dia-mint" style={{ display: 'none', isolation: 'isolate' }} aria-hidden="true">
        <div data-aurora className="absolute inset-0 opacity-0" style={{ background: auroraCss }} />
        {/* centred with flexbox, NOT a transform: a transformed ancestor would
            isolate the letters from the aurora and break the multiply blend */}
        <div className="absolute inset-0 flex items-center justify-center pb-[8vh]">
        <div className="relative" style={{ width: 'min(86vw, 700px)', aspectRatio: '4 / 2.85' }}>
          {[['d', 'left-0 top-0', dMulM, dAddM], ['s', 'right-0 bottom-0', sMulM, sAddM]].map(([k, pos, mul, add]) => (
            <div key={k} className={`absolute w-[60%] ${pos}`} style={{ aspectRatio: '4 / 3' }}>
              <img data-d={k === 'd' ? '' : undefined} data-s={k === 's' ? '' : undefined} src={mul} alt=""
                className="absolute inset-0 h-full w-full opacity-0" style={{ mixBlendMode: 'multiply' }} draggable={false} />
              <img data-d={k === 'd' ? '' : undefined} data-s={k === 's' ? '' : undefined} src={add} alt=""
                className="absolute inset-0 h-full w-full opacity-0" style={{ mixBlendMode: 'screen', filter: 'brightness(0.17)' }} draggable={false} />
            </div>
          ))}
        </div>
        </div>
      </div>


      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) }}
        className="dia-label absolute bottom-5 right-5 rounded-full border border-dia-cyan/30 bg-dia-mint/70 px-4 py-2 backdrop-blur-sm transition-colors hover:bg-dia-tea focus-visible:outline focus-visible:outline-2 focus-visible:outline-dia-cyan"
      >
        Skip
      </button>
    </div>
  )
}
