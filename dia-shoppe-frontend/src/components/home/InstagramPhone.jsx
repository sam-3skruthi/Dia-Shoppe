import { useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ContainerScroll } from '../ui/ContainerScroll'
import SocialIcons from './SocialIcons'
import { social, isLink } from '../../data/social'
import { categories } from '../../data/products'
import { useReveal } from '../../lib/useReveal'

/*
  About / Instagram — replaces the old certifications band. A floating phone
  (ContainerScroll tilts it upright as you scroll) shows a profile-style screen
  for Dia Shoppe, with a "Follow" label and arrow pointing at it.

  The destination comes from src/data/social.js. With no confirmed https URL
  the phone and label render but nothing is clickable: no invented URL, no
  broken link. The screen is a designed preview (brand name, existing site
  copy, category photos); it shows no follower counts or posts we cannot back.
  Keeps id="about" because the header's About link scrolls here.
*/
const TILES = [
  ...categories.map((c) => ({ kind: 'photo', src: `/categories/${c.slug}.jpg`, alt: c.label })),
  { kind: 'text', text: 'Since 2004', tone: 'bg-dia-tea text-dia-cyan' },
  { kind: 'text', text: '100% Authentic', tone: 'bg-dia-aqua/20 text-dia-ink' },
  { kind: 'text', text: 'PAN-India Delivery', tone: 'bg-dia-ink text-dia-tea' },
]

function PhoneScreen() {
  return (
    <div className="relative flex h-full flex-col bg-white text-dia-ink">
      <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-dia-ink" aria-hidden="true" />
      <div className="flex items-center justify-center border-b border-dia-ink/10 px-4 pb-3 pt-9">
        <span className="font-heading text-[15px] font-bold">Dia Shoppe</span>
      </div>

      <div className="flex items-center gap-4 px-4 pt-4">
        <div className="rounded-full bg-[conic-gradient(from_200deg,#25C5E9,#2CD3C2,#CAFFDE,#238689,#25C5E9)] p-[3px]">
          <div className="rounded-full bg-white p-[3px]">
            <img src="/logos/ds-emblem.png" alt="" className="h-[68px] w-[68px] rounded-full object-cover" />
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-heading text-lg font-extrabold leading-tight">Dia Shoppe</div>
          <div className="text-xs text-dia-ink/60">Medical &amp; surgical equipment</div>
        </div>
      </div>

      <p className="px-4 pt-3 text-[13px] leading-snug text-dia-ink/75">
        Trusted since 2004. Glucose &amp; BP monitors, respiratory and hospital equipment, delivered across India.
      </p>

      <div className="px-4 pt-3">
        <span className="flex h-9 items-center justify-center rounded-lg bg-gradient-to-r from-dia-cyan to-dia-aqua text-sm font-bold text-white">
          Follow
        </span>
      </div>

      <div className="mt-4 grid flex-1 grid-cols-3 gap-[2px] overflow-hidden border-t border-dia-ink/10 bg-dia-ink/10 pt-[2px]">
        {TILES.map((t, i) =>
          t.kind === 'photo' ? (
            <img key={i} src={t.src} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div key={i} className={`flex items-center justify-center p-2 text-center font-heading text-[12px] font-extrabold leading-tight ${t.tone}`}>
              {t.text}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function Phone({ href }) {
  const body = (
    <div className="relative mx-auto h-[600px] w-[min(300px,78vw)] rounded-[46px] bg-dia-ink p-[10px] shadow-[0_60px_90px_-30px_rgba(2,18,37,0.55),0_0_0_1.5px_rgba(35,134,137,0.5),inset_0_0_0_2px_rgba(255,255,255,0.08)]">
      <div className="h-full overflow-hidden rounded-[37px]">
        <PhoneScreen />
      </div>
    </div>
  )
  if (!href) return body
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open the official Dia Shoppe Instagram profile (opens in a new tab)"
      className="block rounded-[46px] outline-none transition-transform duration-300 hover:-translate-y-1 focus-visible:ring-[3px] focus-visible:ring-dia-aqua/70"
    >
      {body}
    </a>
  )
}

/* "Follow" label + a hand-drawn style arrow that draws itself toward the phone. */
function FollowCue() {
  const reduce = useReducedMotion()
  const draw = reduce ? {} : { initial: { pathLength: 0 }, whileInView: { pathLength: 1 }, viewport: { once: true, margin: '-80px' }, transition: { duration: 1.4, ease: 'easeOut', delay: 0.3 } }
  return (
    <>
      {/* wide screens: label to the left, arrow curving toward the phone */}
      <div className="pointer-events-none absolute right-[calc(50%+190px)] top-24 hidden items-start gap-1 md:flex" aria-hidden="true">
        <span className="dia-label rounded-full border border-dia-cyan/30 bg-white/80 px-4 py-2 text-sm backdrop-blur">Follow</span>
        <svg width="130" height="90" viewBox="0 0 130 90" fill="none" className="-mt-1 text-dia-cyan">
          <motion.path d="M4 10 C 50 -4, 100 20, 118 70" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" {...draw} />
          <motion.path d="M104 62 L118 72 L124 54" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...draw} />
        </svg>
      </div>
      {/* phones: label above the screen, arrow pointing down */}
      <div className="pointer-events-none mb-3 flex flex-col items-center gap-1 md:hidden" aria-hidden="true">
        <span className="dia-label rounded-full border border-dia-cyan/30 bg-white/80 px-4 py-2 text-sm backdrop-blur">Follow</span>
        <svg width="26" height="44" viewBox="0 0 26 44" fill="none" className="text-dia-cyan">
          <motion.path d="M13 2 V38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" {...draw} />
          <motion.path d="M4 29 L13 40 L22 29" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...draw} />
        </svg>
      </div>
    </>
  )
}

export default function InstagramPhone() {
  const rootRef = useRef(null)
  useReveal(rootRef)
  const href = isLink(social.instagram?.url) ? social.instagram.url.trim() : null

  return (
    <section ref={rootRef} id="about" className="relative overflow-hidden pb-16 pt-20 sm:pt-28">
      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ContainerScroll
          cardClassName="relative mx-auto w-full max-w-[300px]"
          titleComponent={
            <div>
              <span className="dia-label inline-block rounded-full border border-dia-cyan/25 bg-white/60 px-3 py-1 backdrop-blur">About Us</span>
              <h2 className="mt-4 font-heading text-4xl font-extrabold text-dia-ink sm:text-5xl">Follow Dia Shoppe</h2>
              <p className="mx-auto mt-3 max-w-xl text-lg text-dia-ink/65">
                Trusted medical &amp; surgical equipment since 2004. See what is new and say hello on Instagram.
              </p>
            </div>
          }
        >
          <FollowCue />
          <Phone href={href} />
        </ContainerScroll>
        <SocialIcons className="mt-4" />
      </div>
    </section>
  )
}
