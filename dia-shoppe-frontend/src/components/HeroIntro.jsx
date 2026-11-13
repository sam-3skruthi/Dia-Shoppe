import { useEffect, useRef } from 'react'
import { motion, useAnimation } from 'framer-motion'

/*
  Landing-page intro choreography (no white box — the logo floats):
    1. the "DS" emblem flies in from the left and the "Dia Shoppe" wordings
       fly in from the right; they meet and assemble in the centre.
    2. "Surgical Distributors" fades up beneath them.
    3. the whole lockup flies up-left and shrinks to the exact spot of the
       header brand (measured live via `targetRef`).
  When it arrives, `onReveal` fires (header brand fades in + hero copy animates
  in); once it has faded out, `onDone` fires so the parent can unmount it.
*/
const EASE = [0.22, 1, 0.36, 1]

export default function HeroIntro({ targetRef, onReveal, onDone }) {
  const lockup = useAnimation()   // the assembled logo wrapper (handles the fly)
  const emblem = useAnimation()   // "DS" emblem — comes from the left
  const word = useAnimation()     // "Dia Shoppe" wordings — comes from the right
  const tagline = useAnimation()  // "Surgical Distributors"
  const chipRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      onReveal?.()
      onDone?.()
      return
    }

    // The overlay is fixed, so if the user scrolls away mid-intro it would
    // float over the next sections. Bail out instantly on any scroll: skip
    // the remaining choreography and hand over to the real header brand.
    const bail = () => {
      if (cancelled) return
      cancelled = true
      window.removeEventListener('scroll', bail)
      onReveal?.()
      onDone?.()
    }
    window.addEventListener('scroll', bail, { passive: true })
    const run = async () => {
      await new Promise((r) => requestAnimationFrame(r))

      // 1 — the two halves slide in and assemble in the centre
      await Promise.all([
        emblem.start({ x: 0, opacity: 1, transition: { duration: 0.8, ease: EASE } }),
        word.start({ x: 0, opacity: 1, transition: { duration: 0.8, ease: EASE } }),
      ])
      if (cancelled) return

      // 2 — tagline appears once they're together
      await tagline.start({ opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } })
      if (cancelled) return
      await new Promise((r) => setTimeout(r, 750)) // hold
      if (cancelled) return

      // measure where to fly to (the header brand) and how much to shrink
      const target = targetRef?.current?.getBoundingClientRect()
      const chip = chipRef.current?.getBoundingClientRect()
      let dx = 0, dy = -window.innerHeight * 0.34, scale = 0.4
      if (target && chip && chip.height) {
        dx = (target.left + target.width / 2) - (chip.left + chip.width / 2)
        dy = (target.top + target.height / 2) - (chip.top + chip.height / 2)
        scale = target.height / chip.height
      }

      tagline.start({ opacity: 0, y: -12, transition: { duration: 0.35 } })
      // 3 — fly to the header spot
      await lockup.start({ x: dx, y: dy, scale, transition: { duration: 0.85, ease: EASE } })
      if (cancelled) return
      onReveal?.()
      // hand over to the real header brand
      await lockup.start({ opacity: 0, transition: { duration: 0.3 } })
      if (cancelled) return
      onDone?.()
    }
    run()
    return () => {
      cancelled = true
      window.removeEventListener('scroll', bail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center pointer-events-none">
      <motion.div
        ref={chipRef}
        initial={{ opacity: 1, scale: 1 }}
        animate={lockup}
        className="flex items-center gap-3 sm:gap-4 drop-shadow-[0_4px_18px_rgba(2,18,37,0.35)]"
      >
        <motion.img
          src="/logos/ds-emblem.png"
          alt=""
          aria-hidden="true"
          initial={{ x: -220, opacity: 0 }}
          animate={emblem}
          className="h-16 sm:h-24 w-auto"
        />
        <motion.span
          initial={{ x: 220, opacity: 0 }}
          animate={word}
          className="font-display font-bold leading-none tracking-tight text-4xl sm:text-6xl whitespace-nowrap"
        >
          <span className="text-white">Dia </span>
          <span className="text-secondary-300">Shoppe</span>
        </motion.span>
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={tagline}
        className="mt-6 font-display text-white text-xl sm:text-2xl tracking-wide drop-shadow"
      >
        Surgical Distributors
      </motion.p>
    </div>
  )
}
