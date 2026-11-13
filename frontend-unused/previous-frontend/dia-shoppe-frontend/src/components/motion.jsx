/*
  Small, reusable motion primitives built on framer-motion.
  Tuned for a calm, professional medical brand — gentle fades and short
  rises, never bouncy. Honors prefers-reduced-motion automatically because
  framer-motion respects the OS setting via useReducedMotion where used.
*/
import { motion, AnimatePresence, useInView, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

const EASE = [0.22, 1, 0.36, 1] // soft ease-out

/* Fade + rise as the element scrolls into view (once). */
export function Reveal({ children, delay = 0, y = 24, className = '', as = 'div' }) {
  const reduce = useReducedMotion()
  const MotionTag = motion[as] || motion.div
  return (
    <MotionTag
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </MotionTag>
  )
}

/* Parent that staggers its <Stagger.Item> children in sequence. */
export function Stagger({ children, className = '', gap = 0.08 }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      variants={{ show: { transition: { staggerChildren: gap } } }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className = '', y = 20 }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduce ? { opacity: 0 } : { opacity: 0, y },
        show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  )
}

/*
  Counts from 0 to `end` when scrolled into view. Renders the numeric part
  only; pass prefix/suffix (e.g. "+", "K+") around it.
*/
export function CountUp({ end, duration = 1400, className = '', suffix = '', prefix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!inView) return
    if (reduce) { setValue(end); return }
    let raf
    const start = performance.now()
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
      setValue(Math.round(end * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, end, duration, reduce])

  return (
    <span ref={ref} className={className}>
      {prefix}{value.toLocaleString()}{suffix}
    </span>
  )
}

/*
  Slot-machine ticker: shows `from`, then rolls to `to` (vertical slide +
  fade) once scrolled into view. e.g. from="22/7" to="24/7".
*/
export function Ticker({ from, to, className = '', delay = 350 }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const [rolled, setRolled] = useState(false)

  useEffect(() => {
    if (!inView) return
    if (reduce) { setRolled(true); return }
    const t = setTimeout(() => setRolled(true), delay)
    return () => clearTimeout(t)
  }, [inView, reduce, delay])

  return (
    <span ref={ref} className={`relative inline-block overflow-hidden align-bottom ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={rolled ? 'to' : 'from'}
          className="inline-block"
          initial={reduce ? false : { y: '0.9em', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? {} : { y: '-0.9em', opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          {rolled ? to : from}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export { motion }
