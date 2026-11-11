import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import { Reveal, motion } from '../components/motion'
import CinematicHero from '../components/CinematicHero'
import DiaLoader from '../components/loader/DiaLoader'
import { shouldPlayLoader } from '../lib/loaderSession'
import { useSmoothScroll } from '../lib/smoothScroll'
import { LiquidGlassDefs } from '../components/ui/buttons'
import BrandMarquee from '../components/BrandMarquee'
import SaleBanner from '../components/SaleBanner'
import SaleRibbonX from '../components/SaleRibbonX'
import { categories } from '../data/products'
import { useCatalog } from '../context/CatalogContext'
import { FiShield, FiAward, FiHeadphones } from 'react-icons/fi'

// Below-the-fold sections are separate chunks, so GSAP and the carousels stay
// out of the main bundle and load right after the page is interactive.
const CategoryShowcase = lazy(() => import('../components/home/CategoryShowcase'))
const FeaturedDepth = lazy(() => import('../components/home/FeaturedDepth'))
const TestimonialsFlip = lazy(() => import('../components/home/TestimonialsFlip'))
const InstagramPhone = lazy(() => import('../components/home/InstagramPhone'))

/* ── Data ─────────────────────────────────────── */

// ⚠ AUTHENTICITY: these six entries are unchanged from the original homepage.
// Confirm they are real customer words before launch; nothing here was written
// or edited as part of the revamp.
const testimonials = [
  { name: 'Dr. Ramesh Kumar', role: 'Cardiologist, Apollo Hospital', text: 'Dia Shoppe has been our go-to supplier for BP monitors and glucometers for over 5 years. Reliable, authentic products and excellent service.', rating: 5 },
  { name: 'Priya Sharma',     role: 'Customer, Bengaluru',            text: 'Ordered an Accu-Check for my mother. Delivered within 2 days, product is 100% original. Will definitely order again!', rating: 5 },
  { name: 'MediCare Pharmacy', role: 'Retail Partner, Chennai',       text: 'Great bulk pricing for pharmacies. Our stock is always fresh and we get the best support from their team.', rating: 5 },
  { name: 'Sunita Rao',        role: 'Physiotherapist, Hyderabad',    text: 'The walker and BP apparatus I ordered were genuine and well-packed. Their support team helped me pick the right model.', rating: 5 },
  { name: 'CityCare Clinic',   role: 'Clinic Partner, Delhi NCR',     text: 'Consistent stock, honest pricing and quick replacements when needed. Exactly what a busy clinic wants from a supplier.', rating: 5 },
  { name: 'Anil Verma',        role: 'Customer, Mumbai',              text: 'Bought a nebulizer for my father. Original Philips unit, sealed box, delivered fast. Highly recommended.', rating: 4 },
]

/* Reserves each section's height while its chunk loads (no layout jump). */
function SectionFallback({ className = 'min-h-[640px]' }) {
  return <div className={className} aria-hidden="true" />
}

/* ── Page ─────────────────────────────────────── */

export default function Home() {
  const { products } = useCatalog()
  // Loading animation: first homepage entry of a browser session only.
  // Later visits skip straight to the revealed page (introDone starts true).
  const [loaderPlanned] = useState(shouldPlayLoader)
  const [loaderOn, setLoaderOn] = useState(loaderPlanned)
  const [introDone, setIntroDone] = useState(!loaderPlanned)
  const { hash } = useLocation()

  // Lenis smooth scrolling on the homepage (starts once the loader is gone).
  useSmoothScroll(!loaderOn)

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
    <div className="dia-theme min-h-screen">
      <LiquidGlassDefs />
      {/* White top strip with the brand logos */}
      <BrandMarquee />
      <SaleBanner />

      {/* Hero sits below the strip; transparent nav overlays the video */}
      <div className="relative">
        <Header overlay brandReady={introDone} />
        {/* ── Cinematic Hero — unrolls top→down like a window blind on entry ── */}
        <motion.div
          initial={{ clipPath: 'inset(0 0 100% 0)' }}
          animate={{ clipPath: 'inset(0 0 0% 0)', transitionEnd: { clipPath: 'none' } }}   // no leftover clip layer once unrolled
          transition={{ duration: 1.05, ease: [0.22, 1, 0.36, 1] }}
        >
          <CinematicHero start={introDone} />
        </motion.div>
      </div>

      {/* Loading animation — Crystal Formation × Aurora Reveal (once per session) */}
      {loaderOn && (
        <DiaLoader onReveal={() => setIntroDone(true)} onDone={() => setLoaderOn(false)} />
      )}

      {/* ── Trust Bar ── */}
      <div className="pb-2 pt-10">
        <Reveal className="mx-auto flex max-w-7xl flex-wrap justify-center gap-x-8 gap-y-3 px-4 text-sm font-medium text-dia-ink/80">
          <span className="flex items-center gap-1.5"><FiShield size={16} className="text-dia-cyan" /> 100% Authentic Products</span>
          <span className="flex items-center gap-1.5"><FiAward size={16} className="text-dia-cyan" /> Trusted Brand Partners</span>
          <span className="flex items-center gap-1.5"><FiHeadphones size={16} className="text-dia-cyan" /> Expert Support Available</span>
        </Reveal>
      </div>

      {/* ── Shop by Category — circular carousel + category panel ── */}
      <Suspense fallback={<SectionFallback className="min-h-[1000px]" />}>
        <CategoryShowcase categories={categories} products={products} />
      </Suspense>

      {/* ── Sale ribbon (X) — only shows while the sale design is on ── */}
      <SaleRibbonX />

      {/* ── Featured Products — depth carousel ── */}
      <Suspense fallback={<SectionFallback className="min-h-[700px]" />}>
        <FeaturedDepth products={products} />
      </Suspense>

      {/* ── Testimonials — flip cards ── */}
      <Suspense fallback={<SectionFallback className="min-h-[640px]" />}>
        <TestimonialsFlip testimonials={testimonials} />
      </Suspense>

      {/* ── About / Instagram — replaces the old certifications band ── */}
      <Suspense fallback={<SectionFallback className="min-h-[760px]" />}>
        <InstagramPhone />
      </Suspense>

      <Footer />
    </div>
  )
}
