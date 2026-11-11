import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from './motion'
import { FiAward, FiChevronDown } from 'react-icons/fi'

/*
  Full-bleed cinematic hero with a curved ("inverted semicircle") bottom edge.
  Background priority:
    1. /public/hero-vid.mp4  — looping background video → <video>
    2. /public/hero-bp.webp  — still photo poster / Ken Burns fallback
    3. deep-blue → teal gradient (always underneath)
*/
export default function CinematicHero({ start = true }) {
  const [videoOk, setVideoOk] = useState(true)
  const [imgOk, setImgOk] = useState(true)

  return (
    <section className="relative overflow-hidden min-h-[92vh] flex items-center justify-center text-white text-center rounded-b-[50%]">
      {/* ── Background layers ── */}
      <div className="absolute inset-0 bg-gradient-to-br from-ink-950 via-primary-950 to-secondary-900" aria-hidden="true" />

      {videoOk && (
        <video
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay muted loop playsInline
          poster="/hero-bp.webp"
          onError={() => setVideoOk(false)}
        >
          <source src="/hero-vid.mp4" type="video/mp4" />
        </video>
      )}

      {!videoOk && imgOk && (
        <img
          src="/hero-bp.webp"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover origin-center animate-kenburns"
          onError={() => setImgOk(false)}
        />
      )}

      {/* Light, transparent overlays — keep the video bright, with a soft teal
          tint and just enough darkening at top/bottom for legible text */}
      <div className="absolute inset-0 bg-ink-950/25" aria-hidden="true" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950/65 via-transparent to-ink-950/30" aria-hidden="true" />
      <div className="absolute inset-0 bg-secondary-300/10 mix-blend-soft-light" aria-hidden="true" />
      {/* light navy gradient pooled in the corners (vignette) */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(4,13,24,0.6)_100%)]" aria-hidden="true" />

      {/* ── Foreground content (centered, editorial) ── */}
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 w-full pt-36 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={start ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-xs sm:text-sm mb-7 backdrop-blur-md tracking-wide uppercase">
            <FiAward size={14} className="text-secondary-300" />
            Trusted Since 2004
          </div>

          <h1 className="font-display font-semibold leading-[1.05] tracking-tight text-4xl sm:text-5xl lg:text-[4.25rem] mb-6">
            Healthcare equipment,<br />
            <span className="italic text-secondary-300">designed around you</span>
          </h1>

          <p className="text-blue-100/90 text-base sm:text-lg mb-9 max-w-xl mx-auto leading-relaxed">
            Authentic glucose &amp; BP monitors, respiratory and hospital
            equipment from the brands you trust — delivered across India,
            fast and reliably.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }}>
              <Link
                to="/products"
                className="inline-block bg-secondary-500 hover:bg-secondary-400 text-ink-950 font-semibold px-8 py-3.5 rounded-full transition-colors shadow-lg shadow-secondary-900/30"
              >
                Shop Now
              </Link>
            </motion.div>
            <a
              href="#categories"
              className="inline-block bg-white/10 hover:bg-white/20 border border-white/30 backdrop-blur-md text-white font-semibold px-8 py-3.5 rounded-full transition-colors"
            >
              Browse Categories
            </a>
          </div>
        </motion.div>
      </div>

      {/* Scroll cue — centred with flex (the float animation owns `transform`,
          so translate-x centring gets overridden); sits at the curve's dip */}
      <div className="absolute bottom-8 inset-x-0 flex justify-center pointer-events-none">
        <a
          href="#categories"
          className="pointer-events-auto text-white/70 hover:text-white transition-opacity duration-500 animate-float-slow"
          style={{ opacity: start ? 1 : 0 }}
          aria-label="Scroll to categories"
        >
          <FiChevronDown size={28} />
        </a>
      </div>
    </section>
  )
}
