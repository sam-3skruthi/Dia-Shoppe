import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Header from '../components/Header'
import Footer from '../components/Footer'
import ProductCard from '../components/ProductCard'
import { Reveal, Stagger, StaggerItem, motion } from '../components/motion'
import CinematicHero from '../components/CinematicHero'
import HeroIntro from '../components/HeroIntro'
import BrandMarquee from '../components/BrandMarquee'
import SaleBanner from '../components/SaleBanner'
import SaleRibbonX from '../components/SaleRibbonX'
import PageBackdrop from '../components/PageBackdrop'
import { categories } from '../data/products'
import { useCatalog } from '../context/CatalogContext'
import {
  FiShield, FiAward, FiHeadphones,
  FiStar, FiChevronRight
} from 'react-icons/fi'

/* ── Data ─────────────────────────────────────── */

const testimonials = [
  { name: 'Dr. Ramesh Kumar', role: 'Cardiologist, Apollo Hospital', text: 'Dia Shoppe has been our go-to supplier for BP monitors and glucometers for over 5 years. Reliable, authentic products and excellent service.', rating: 5 },
  { name: 'Priya Sharma',     role: 'Customer, Bengaluru',            text: 'Ordered an Accu-Check for my mother. Delivered within 2 days, product is 100% original. Will definitely order again!', rating: 5 },
  { name: 'MediCare Pharmacy', role: 'Retail Partner, Chennai',       text: 'Great bulk pricing for pharmacies. Our stock is always fresh and we get the best support from their team.', rating: 5 },
  { name: 'Sunita Rao',        role: 'Physiotherapist, Hyderabad',    text: 'The walker and BP apparatus I ordered were genuine and well-packed. Their support team helped me pick the right model.', rating: 5 },
  { name: 'CityCare Clinic',   role: 'Clinic Partner, Delhi NCR',     text: 'Consistent stock, honest pricing and quick replacements when needed. Exactly what a busy clinic wants from a supplier.', rating: 5 },
  { name: 'Anil Verma',        role: 'Customer, Mumbai',              text: 'Bought a nebulizer for my father. Original Philips unit, sealed box, delivered fast. Highly recommended.', rating: 4 },
]

/* Certification scans shown in the About section. Add an entry per image
   placed in /public/certificates — the section stays hidden while empty. */
const CERTIFICATES = [
  // { file: 'iso-9001.jpg', label: 'ISO 9001:2015 Certified' },
]

// testimonials rotate in vertical groups of 3
const T_GROUPS = Math.ceil(testimonials.length / 3)

/* ── Sub-components ───────────────────────────── */

function Stars({ count }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <FiStar key={i} size={14} className="fill-yellow-400 text-yellow-400" />
      ))}
    </div>
  )
}

/* Image-led category card: drop photos into /public/categories/<slug>.jpg and
   they show automatically; until then a teal-navy gradient plate stands in.
   Hover = slow photo zoom + card lift; wording sits on a dark bottom fade. */
function CategoryCard({ cat }) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <motion.div whileHover={{ y: -8 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
      <Link
        to={`/products?category=${cat.slug}`}
        className="group relative block aspect-[4/5] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-lg shadow-black/30"
      >
        {imgOk ? (
          <img
            src={`/categories/${cat.slug}.jpg`}
            alt={cat.label}
            loading="lazy"
            onError={() => setImgOk(false)}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-900 via-ink-900 to-secondary-900 transition-transform duration-700 group-hover:scale-110" />
        )}
        {/* legibility fade */}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/25 to-transparent" />
        <div className="absolute bottom-0 inset-x-0 p-4 text-left">
          <div className="font-semibold text-white text-sm leading-tight">{cat.label}</div>
          <div className="text-blue-100/60 text-xs mt-0.5 leading-snug line-clamp-2">{cat.desc}</div>
          <div className="h-0.5 w-0 group-hover:w-10 bg-secondary-400 rounded-full mt-2 transition-all duration-500" />
        </div>
      </Link>
    </motion.div>
  )
}

function TestimonialCard({ t }) {
  return (
    <div className="h-full bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
      <Stars count={t.rating} />
      <p className="text-blue-100/90 text-sm mt-3 mb-4 leading-relaxed">"{t.text}"</p>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-secondary-500/20 flex items-center justify-center font-bold text-secondary-200">
          {t.name.charAt(0)}
        </div>
        <div>
          <div className="font-semibold text-white text-sm">{t.name}</div>
          <div className="text-blue-100/60 text-xs">{t.role}</div>
        </div>
      </div>
    </div>
  )
}

/* ── Page ─────────────────────────────────────── */

export default function Home() {
  const { products } = useCatalog()
  const featuredProducts = products.slice(0, 6)
  const brandRef = useRef(null)
  const [showIntro, setShowIntro] = useState(true)
  const [introDone, setIntroDone] = useState(false)
  const [heroOpen, setHeroOpen] = useState(false)
  const [tPage, setTPage] = useState(0)
  const { hash } = useLocation()

  // Testimonials: all three cards swap together every few seconds —
  // the new card drops in from the top while the old one exits below.
  // (0.75s faster per user: 4.5s → 3.75s cycle)
  useEffect(() => {
    const id = setInterval(() => setTPage((p) => (p + 1) % T_GROUPS), 3750)
    return () => clearInterval(id)
  }, [])

  // When navigated here with a hash (e.g. /#about, /#contact from the nav),
  // scroll to that section. Small delay lets the page lay out first.
  useEffect(() => {
    if (!hash) return
    const el = document.getElementById(hash.slice(1))
    if (el) {
      const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 250)
      return () => clearTimeout(t)
    }
  }, [hash])

  return (
    <div className="min-h-screen">
      {/* Navy testimonials-style backdrop behind the whole landing page */}
      <PageBackdrop />
      {/* White top strip with the brand logos */}
      <BrandMarquee />
      <SaleBanner />

      {/* Hero sits below the strip; transparent nav overlays the video */}
      <div className="relative">
        <Header overlay brandReady={introDone} brandRef={brandRef} />
        {/* ── Cinematic Hero — unrolls top→down like a window blind on entry,
             then the logo intro plays ── */}
        <motion.div
          initial={{ clipPath: 'inset(0 0 100% 0)' }}
          animate={{ clipPath: 'inset(0 0 0% 0)' }}
          transition={{ duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
          onAnimationComplete={() => setHeroOpen(true)}
        >
          <CinematicHero start={introDone} />
        </motion.div>
      </div>

      {/* Intro: emblem + wordings assemble, then fly up into the header brand.
          Mounts only after the hero has finished unrolling. */}
      {heroOpen && showIntro && (
        <HeroIntro
          targetRef={brandRef}
          onReveal={() => setIntroDone(true)}
          onDone={() => setShowIntro(false)}
        />
      )}

      {/* ── Trust Bar ── */}
      <div className="pt-8 pb-2">
        <Reveal className="max-w-7xl mx-auto px-4 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm font-medium text-blue-100/80">
          <span className="flex items-center gap-1.5"><FiShield size={16} className="text-secondary-400" /> 100% Authentic Products</span>
          <span className="flex items-center gap-1.5"><FiAward size={16} className="text-secondary-400" /> Trusted Brand Partners</span>
          <span className="flex items-center gap-1.5"><FiHeadphones size={16} className="text-secondary-400" /> Expert Support Available</span>
        </Reveal>
      </div>

      {/* ── Categories — image cards on the shared navy backdrop ── */}
      <section id="categories" className="relative py-14 sm:py-20">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center mb-10">
            <span className="inline-block text-secondary-200 font-semibold text-xs uppercase tracking-[0.18em] bg-white/10 border border-white/15 rounded-full px-3 py-1">Categories</span>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-white mt-3">Shop by Category</h2>
            <p className="text-blue-100/70 mt-2">Find exactly what you need from our wide range</p>
          </Reveal>
          <Stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {categories.map((cat) => (
              <StaggerItem key={cat.label}>
                <CategoryCard cat={cat} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ── Sale ribbon (X) — only shows while the sale design is on ── */}
      <SaleRibbonX />

      {/* ── Featured Products — white band with teal glow under the cards ── */}
      <section className="relative bg-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="flex items-end justify-between mb-8">
            <div>
              <span className="inline-block text-secondary-700 font-semibold text-xs uppercase tracking-[0.18em] bg-secondary-50 border border-secondary-100 rounded-full px-3 py-1">Top Picks</span>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink-900 mt-3">Featured Products</h2>
            </div>
            <Link to="/products" className="flex items-center gap-1 text-primary-700 font-semibold text-sm hover:underline">
              View All <FiChevronRight size={16} />
            </Link>
          </Reveal>
          <Stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {featuredProducts.map((p) => (
              <StaggerItem key={p.id}>
                <div className="h-full rounded-2xl shadow-[0_26px_50px_-18px_rgba(20,184,166,0.5)]">
                  <ProductCard product={p} />
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ── Testimonials — open on the navy backdrop; cards rotate vertically
           (new card drops from the top, old card exits below, all three at once) ── */}
      <section id="testimonials" className="py-20 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center mb-10">
            <span className="inline-block text-secondary-200 font-semibold text-xs uppercase tracking-[0.18em] bg-white/10 border border-white/15 rounded-full px-3 py-1">Testimonials</span>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-white mt-3">What Our Customers Say</h2>
            <p className="text-blue-100/70 mt-2">Trusted by hospitals, clinics and individuals across India</p>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[0, 1, 2].map((col) => {
              const t = testimonials[(tPage * 3 + col) % testimonials.length]
              return (
                <div key={col} className="relative overflow-hidden">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={`${tPage}-${col}`}
                      initial={{ y: -80, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: 80, opacity: 0 }}
                      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                      className="h-full"
                    >
                      <TestimonialCard t={t} />
                    </motion.div>
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── About — certifications & recognitions (placeholder until the
           certificate images are supplied) ── */}
      <section id="about" className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center">
            <span className="inline-block text-secondary-700 font-semibold text-xs uppercase tracking-[0.18em] bg-secondary-50 border border-secondary-100 rounded-full px-3 py-1">About Us</span>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink-900 mt-3">Certified &amp; Recognised</h2>
            <p className="text-gray-500 mt-2">Our certifications and industry recognitions</p>
          </Reveal>
          {/* Drop the certificate scans into /public/certificates and list the
              filenames in CERTIFICATES above. Until then the grid renders
              nothing rather than leaving an empty 200px band on the page. */}
          {CERTIFICATES.length > 0 && (
            <Stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 mt-10">
              {CERTIFICATES.map((c) => (
                <StaggerItem key={c.file}>
                  <figure className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 h-full flex flex-col">
                    <img
                      src={`/certificates/${c.file}`}
                      alt={c.label}
                      loading="lazy"
                      className="w-full h-40 object-contain rounded-lg bg-gray-50"
                    />
                    <figcaption className="text-xs text-gray-500 text-center mt-2 leading-snug">{c.label}</figcaption>
                  </figure>
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </div>
      </section>

      <Footer />
    </div>
  )
}
