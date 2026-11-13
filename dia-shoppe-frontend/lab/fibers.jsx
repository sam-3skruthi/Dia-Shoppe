import { createRoot } from 'react-dom/client'
import GhostFibers from '../src/components/bits/GhostFibers'

/*
  The SAME ghost fibres as the live site (DiaBackdrop settings), mounted as a
  fixed background for the lab, plus the same "trail" mask: every frame the
  fibres are blurred, stacked and added onto a slowly fading mask, so the
  letters are seen only where fibres pass and fade back out behind them.
  The mask is a viewport-sized canvas the 3D renderer samples per pixel.
*/
export const MASK_SCALE = 0.5
const MASK_BOOST = 2
const MASK_FADE = 0.2   // short trail: a slice fades within ~0.3 s
const CURSOR_RADIUS = 80  // px: size of the cursor's light

export function mountFibers(el) {
  const mask = document.createElement('canvas')
  const cursor = { x: 0, y: 0, inside: false }
  window.addEventListener('pointermove', (e) => { cursor.x = e.clientX; cursor.y = e.clientY; cursor.inside = true }, { passive: true })
  document.documentElement.addEventListener('pointerleave', () => { cursor.inside = false })
  let tick = 0
  const onFrame = (fiber) => {
    tick += 1
    if (tick % 2) return
    const cw = Math.max(1, Math.round(window.innerWidth * MASK_SCALE))
    const ch = Math.max(1, Math.round(window.innerHeight * MASK_SCALE))
    if (mask.width !== cw || mask.height !== ch) { mask.width = cw; mask.height = ch }
    const m = mask.getContext('2d')
    m.filter = 'none'
    m.globalCompositeOperation = 'destination-out'
    m.fillStyle = `rgba(0,0,0,${MASK_FADE})`
    m.fillRect(0, 0, cw, ch)
    m.filter = `blur(${Math.round(10 * MASK_SCALE)}px)`   // narrow: slivers, not patches
    m.globalCompositeOperation = 'lighter'
    for (let i = 0; i < MASK_BOOST; i += 1) m.drawImage(fiber, 0, 0, cw, ch)
    m.filter = 'none'
    // the cursor is a second light: a soft spot that lights the part of the
    // letter under it, leaving the same short trail as the fibres
    if (cursor.inside) {
      const x = cursor.x * MASK_SCALE
      const y = cursor.y * MASK_SCALE
      const r = CURSOR_RADIUS * MASK_SCALE
      const g = m.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(0.45, 'rgba(0,0,0,0.85)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      m.fillStyle = g
      m.fillRect(x - r, y - r, r * 2, r * 2)
    }
    m.globalCompositeOperation = 'source-over'
    mask.dirty = true
  }
  createRoot(el).render(
    <div style={{ opacity: 0.55, width: '100%', height: '100%' }}>
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
    </div>,
  )
  return mask
}
