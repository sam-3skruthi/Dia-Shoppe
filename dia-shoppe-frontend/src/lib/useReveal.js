import { useEffect } from 'react'
import { gsap, ScrollTrigger } from './gsapSetup'

/*
  Scroll-driven entrance animation for one section, scoped with gsap.context so
  everything is cleaned up on unmount. Mark elements inside the section with:
    data-reveal            fade + rise when scrolled into view (once)
    data-reveal-delay="s"  optional delay in seconds
    data-reveal-group      its direct children stagger in
    data-parallax="0.2"    slow vertical drift tied to scroll (scrubbed)
  Skipped entirely for prefers-reduced-motion (content simply stays visible).
*/
export function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined

    const ctx = gsap.context(() => {
      root.querySelectorAll('[data-reveal]').forEach((el) => {
        gsap.from(el, {
          opacity: 0, y: 34, duration: 0.9, ease: 'power3.out',
          delay: parseFloat(el.dataset.revealDelay || '0'),
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        })
      })
      root.querySelectorAll('[data-reveal-group]').forEach((group) => {
        gsap.from(group.children, {
          opacity: 0, y: 44, duration: 0.8, stagger: 0.1, ease: 'power3.out',
          scrollTrigger: { trigger: group, start: 'top 86%', once: true },
        })
      })
      root.querySelectorAll('[data-parallax]').forEach((el) => {
        const speed = parseFloat(el.dataset.parallax) || 0.1
        gsap.fromTo(el, { yPercent: -speed * 50 }, {
          yPercent: speed * 50, ease: 'none',
          scrollTrigger: { trigger: root, start: 'top bottom', end: 'bottom top', scrub: true },
        })
      })
    }, root)

    const t = setTimeout(() => ScrollTrigger.refresh(), 500)   // lazy content has settled
    return () => { clearTimeout(t); ctx.revert() }
  }, [rootRef])
}
