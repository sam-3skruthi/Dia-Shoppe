import { useCallback, useEffect, useRef, useState } from 'react'
import GhostFibers from './bits/GhostFibers'
import { createMonogramRenderer } from '../lib/dsMonogram'

/*
  Site-wide living background.

  One fixed layer behind all page content:
    1. the D + S monogram — the approved script-chrome design, real 3D
       (src/lib/dsMonogram.js), STATIC in the middle of the screen. It is
       invisible except where light passes over it.
    2. ghost fibres — dim Dolphin Dive ribbons drifting on top.

  "Light" = the ghost fibres AND the cursor. Every fibre frame they are painted
  into a mask with a very short trail; the monogram shows only where the mask
  is lit, so a fibre crossing the top edge reveals just the top edge, and it
  fades straight back as the light moves on.

  Anything marked [data-hide-ds] (Featured Products) is cut out of the mask:
  the letters never show there; the fibres themselves still do.

  Desktop only (fine pointer, >= 768px) and never for reduced motion.
*/

const MASK_SCALE = 0.5          // mask resolution relative to the viewport
const MASK_BOOST = 2            // additive copies of the blurred fibres per update
const MASK_FADE = 0.2           // short trail: a lit slice fades within ~0.3 s
const MASK_BLUR = 10            // px: narrow bands → slivers, not patches
const CURSOR_RADIUS = 80        // px: the cursor's light

function useDesktopMotion() {
  const query = '(min-width: 768px) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setOk(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return ok
}

export default function DiaBackdrop({ intensity = 1 }) {
  const enabled = useDesktopMotion()
  const canvasRef = useRef(null)
  const mono = useRef(null)
  const mask = useRef(null)
  const cursor = useRef({ x: 0, y: 0, inside: false })
  const tick = useRef(0)

  // the 3D monogram (one WebGL context), sized to the viewport
  useEffect(() => {
    if (!enabled || !canvasRef.current) return undefined
    const m = createMonogramRenderer(canvasRef.current)
    mono.current = m
    mask.current = document.createElement('canvas')
    const resize = () => m.setSize(window.innerWidth, window.innerHeight)
    resize()
    window.addEventListener('resize', resize)
    const move = (e) => { cursor.current = { x: e.clientX, y: e.clientY, inside: true } }
    const leave = () => { cursor.current.inside = false }
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      mono.current = null
      m.dispose()
    }
  }, [enabled])

  /* Runs right after each fibre frame is drawn (every other frame). */
  const onFrame = useCallback((fiberCanvas) => {
    tick.current += 1
    if (tick.current % 2) return
    const m3d = mono.current
    const canvas = mask.current
    if (!m3d || !canvas) return

    const vw = window.innerWidth
    const vh = window.innerHeight
    const cw = Math.max(1, Math.round(vw * MASK_SCALE))
    const ch = Math.max(1, Math.round(vh * MASK_SCALE))
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }

    const m = canvas.getContext('2d')
    // 1. fade the old light a lot (short trail)
    m.filter = 'none'
    m.globalCompositeOperation = 'destination-out'
    m.fillStyle = `rgba(0,0,0,${MASK_FADE})`
    m.fillRect(0, 0, cw, ch)
    // 2. add the fibres, blurred just enough to make thin bands
    m.filter = `blur(${Math.round(MASK_BLUR * MASK_SCALE)}px)`
    m.globalCompositeOperation = 'lighter'
    for (let i = 0; i < MASK_BOOST; i += 1) m.drawImage(fiberCanvas, 0, 0, cw, ch)
    m.filter = 'none'
    // 3. the cursor is a second light
    const c = cursor.current
    if (c.inside) {
      const x = c.x * MASK_SCALE
      const y = c.y * MASK_SCALE
      const r = CURSOR_RADIUS * MASK_SCALE
      const g = m.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(0.45, 'rgba(0,0,0,0.85)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      m.fillStyle = g
      m.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // 4. never reveal the letters inside [data-hide-ds], with a soft edge
    const feather = Math.round(40 * MASK_SCALE)
    m.globalCompositeOperation = 'destination-out'
    m.fillStyle = '#000'
    document.querySelectorAll('[data-hide-ds]').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.bottom < -feather || r.top > vh + feather) return
      m.filter = `blur(${feather / 2}px)`
      m.fillRect(r.left * MASK_SCALE, r.top * MASK_SCALE + feather / 2, r.width * MASK_SCALE, r.height * MASK_SCALE - feather)
      m.filter = 'none'
      m.fillRect(r.left * MASK_SCALE, r.top * MASK_SCALE + feather, r.width * MASK_SCALE, r.height * MASK_SCALE - 2 * feather)
    })
    m.filter = 'none'
    m.globalCompositeOperation = 'source-over'

    // 5. draw the static monogram through the mask
    m3d.setMask(canvas)
    m3d.render()
  }, [])

  if (!enabled) return null

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ opacity: intensity }} />
      <div className="absolute inset-0" style={{ opacity: 0.55 * intensity }}>
        <GhostFibers
          glowColor="#00B4D8"
          secondaryColor="#0277BD"
          lineColor="#90E0EF"
          gradient="along"
          layers={3}
          waves={1.1}
          twist={1.1}
          threads={64}
          spread={1.25}
          scale={1.15}
          rotation={14}
          speed={0.32}
          flow={0.3}
          depthOfField={0.7}
          particles={0.35}
          sparkle={0.35}
          glow={0.45}
          brightness={0.7}
          vignette={0.2}
          grain={0}
          hoverEffect="part"
          mouseStrength={0.8}
          pulseOnClick={false}
          lightMode
          dpr={1}
          onFrame={onFrame}
        />
      </div>
    </div>
  )
}
