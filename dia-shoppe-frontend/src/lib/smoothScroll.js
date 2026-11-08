import { useEffect } from 'react'

/*
  Lenis smooth scrolling, wired into GSAP's ticker so ScrollTrigger stays in
  sync. Mounted by the homepage only (public pages first; admin pages keep
  native scrolling). Off for prefers-reduced-motion. Lenis and GSAP are loaded
  with dynamic import() so they stay out of the main bundle.
*/
let lenisInstance = null

/** Scroll an element to the middle of the screen (Lenis if active, else native). */
export function scrollToEl(el, offset = -90) {
  if (!el) return
  if (lenisInstance) lenisInstance.scrollTo(el, { offset, duration: 1.2 })
  else el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

export function useSmoothScroll(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    let cancelled = false
    let lenis = null
    let tick = null
    let gsapRef = null

    Promise.all([import('lenis'), import('./gsapSetup')]).then(([{ default: Lenis }, { gsap, ScrollTrigger }]) => {
      if (cancelled) return
      gsapRef = gsap
      lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.9, anchors: true })
      lenisInstance = lenis
      lenis.on('scroll', ScrollTrigger.update)
      tick = (time) => lenis.raf(time * 1000)
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
    })

    return () => {
      cancelled = true
      if (tick && gsapRef) gsapRef.ticker.remove(tick)
      lenis?.destroy()
      if (lenisInstance === lenis) lenisInstance = null
    }
  }, [enabled])
}
