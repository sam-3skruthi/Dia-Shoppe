import { motion, useReducedMotion } from 'framer-motion'
import { useCatalog } from '../context/CatalogContext'

/*
  Sale-frontend piece #2 — a hand-doodled "SALE" for the Products header band's
  right slot (replaces the deal spotlight while the sale design is on).
  Choreography:
    1. the 4 letters fall in from above and settle into place, and
    2. then, on a loop, each letter (S → A → L → E, one per second) grows big
       and shrinks back to normal — a rolling wave across the word.
*/

const LETTERS = ['S', 'A', 'L', 'E']
const FALL_DONE = 1.2 // seconds — when the fall-in has settled and pulsing starts

export default function SaleDoodle() {
  const { saleMode } = useCatalog()
  const reduce = useReducedMotion()
  if (!saleMode) return null

  return (
    <div className="relative flex min-h-[212px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/5 p-5 backdrop-blur-sm">
      <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-secondary-500/25 blur-2xl" aria-hidden="true" />

      <span className="relative text-[11px] font-bold uppercase tracking-[0.22em] text-secondary-300">
        Now On
      </span>

      <div className="relative mt-2 flex items-end gap-1" aria-label="Sale">
        {LETTERS.map((ch, i) => (
          <motion.span
            key={ch}
            className="font-doodle text-7xl sm:text-8xl leading-none text-white"
            style={{ display: 'inline-block', transformOrigin: 'center bottom', textShadow: '0 4px 18px rgba(16,185,129,0.35)' }}
            initial={reduce ? false : { y: -140, opacity: 0, rotate: -8 }}
            animate={
              reduce
                ? { opacity: 1 }
                : { y: 0, opacity: 1, rotate: 0, scale: [1, 1.55, 1] }
            }
            transition={{
              y: { duration: 0.6, delay: i * 0.14, ease: [0.34, 1.56, 0.64, 1] },
              opacity: { duration: 0.4, delay: i * 0.14 },
              rotate: { duration: 0.6, delay: i * 0.14, ease: [0.22, 1, 0.36, 1] },
              // rolling pulse: each letter 1s, one after another, looping
              scale: { duration: 1, delay: FALL_DONE + i * 1, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' },
            }}
          >
            {ch}
          </motion.span>
        ))}
      </div>

      <span className="relative mt-3 text-sm text-blue-100/75">Big savings across the store</span>
    </div>
  )
}
