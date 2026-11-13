import { useRef } from 'react'
import FlipCard from '../ui/FlipCard'
import { useReveal } from '../../lib/useReveal'
import { FiStar } from 'react-icons/fi'

/*
  Testimonials — one FlipCard per testimonial, using the existing six entries
  exactly as supplied by Home.jsx (nothing rewritten or added). Front = the
  words, back = who said it. Hover (mouse), tap, Enter/Space or drag to flip.
*/
function Stars({ count, className = '' }) {
  return (
    <div className={`flex gap-0.5 ${className}`} role="img" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <FiStar key={i} size={15} className={i < count ? 'fill-current' : 'opacity-25'} />
      ))}
    </div>
  )
}

function Front({ t }) {
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden bg-[linear-gradient(150deg,#E0F7FA_0%,#90E0EF_62%,#00B4D8_130%)] p-7 text-dia-ink">
      <svg width="38" height="30" viewBox="0 0 38 30" fill="currentColor" className="text-dia-cyan/45" aria-hidden="true">
        <path d="M0 30V17.2C0 7.1 5.4 1.2 15 0l1.1 4.6C10.9 5.8 8.6 9 8.4 13H16V30H0zm22 0V17.2C22 7.1 27.4 1.2 37 0l1.1 4.6c-5.2 1.2-7.5 4.4-7.7 8.4H38V30H22z" />
      </svg>
      <p className="font-body text-[17px] leading-relaxed">{t.text}</p>
      <div className="flex items-center justify-between">
        <Stars count={t.rating} className="text-dia-cyan" />
        <span className="dia-label dia-glass rounded-full px-3 py-1">Flip</span>
      </div>
    </div>
  )
}

function Back({ t }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-[linear-gradient(160deg,#0277BD_0%,#054F7E_45%,#021225_100%)] p-8 text-center text-dia-mint">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dia-tea/50 bg-gradient-to-br from-dia-aqua/40 to-dia-cyan/30 font-heading text-3xl font-extrabold text-dia-mint shadow-[0_10px_30px_-10px_rgba(0,180,216,0.8)]">
        {t.name.charAt(0)}
      </div>
      <div>
        <div className="font-heading text-xl font-bold">{t.name}</div>
        <div className="mt-1 text-sm text-dia-mint/70">{t.role}</div>
      </div>
      <Stars count={t.rating} className="text-dia-tea" />
      <img src="/logos/ds-emblem.png" alt="" aria-hidden="true" className="mt-2 h-9 w-auto opacity-80" />
    </div>
  )
}

export default function TestimonialsFlip({ testimonials }) {
  const rootRef = useRef(null)
  useReveal(rootRef)

  return (
    <section ref={rootRef} id="testimonials" className="relative overflow-hidden py-20 sm:py-28">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="mx-auto mb-12 max-w-2xl text-center">
          <span className="dia-label dia-glass inline-block rounded-full px-3.5 py-1.5">Testimonials</span>
          <h2 className="mt-4 font-heading text-4xl font-extrabold text-dia-ink sm:text-5xl">What Our Customers Say</h2>
          <p className="mt-3 text-lg text-dia-ink/65">Trusted by hospitals, clinics and individuals across India. Hover over or tap a card to see who said it.</p>
        </div>

        <div data-reveal-group className="grid justify-items-center gap-x-8 gap-y-12 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
          {testimonials.map((t) => (
            <FlipCard
              key={t.name}
              front={<Front t={t} />}
              back={<Back t={t} />}
              axis="y"
              flipOnClick
              flipOnHover
              draggable
              tilt
              tiltMax={10}
              glare
              glareOpacity={0.3}
              hoverScale={1.03}
              perspective={1100}
              stiffness={170}
              damping={20}
              width={300}
              height={400}
              radius={22}
              background="#E0F7FA"
              color="#021225"
              shadowColor="#0277BD"
              shadowOpacity={0.45}
              ariaLabel={`Testimonial from ${t.name}, ${t.role}. Press to flip.`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
