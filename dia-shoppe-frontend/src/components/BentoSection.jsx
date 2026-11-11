import { motion, Reveal, CountUp, Ticker } from './motion'
import DiaShoppeLogo from './DiaShoppeLogo'
import { FiActivity, FiShield, FiTruck } from 'react-icons/fi'

/*
  Asymmetrical bento grid echoing the Veil "How It Works" section, recoloured
  to the deep-blue / teal / grey palette. Includes the animated % counter
  (98 → 100%) and the slot-machine ticker (Mon–Sat → 24/7 style).
*/
const card = 'rounded-3xl p-6 sm:p-7 border transition-shadow'

export default function BentoSection() {
  return (
    <section className="py-20 bg-canvas">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-2xl mb-12">
          <span className="inline-block text-secondary-700 font-semibold text-xs uppercase tracking-[0.18em] bg-secondary-50 border border-secondary-100 rounded-full px-3 py-1 mb-4">
            How It Works
          </span>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ink-900 leading-tight">
            We built sourcing around your real needs — not just a catalogue of
            products.
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-[minmax(0,auto)]">
          {/* Card 1 — tall visual with stat overlay */}
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="md:row-span-2 relative rounded-3xl overflow-hidden border border-gray-200 min-h-[300px] md:min-h-[420px]"
          >
            <img
              src="/hero-bp.webp"
              alt="Customer using a blood pressure monitor at home"
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/20 to-transparent" />
            <div className="absolute bottom-0 p-6 text-white">
              <div className="font-display text-3xl font-semibold">
                <CountUp end={10000} />+
              </div>
              <p className="text-dia-mint/90 text-sm mt-1 max-w-xs">
                Customers across India served with authentic, doctor-trusted
                equipment since 2004.
              </p>
            </div>
          </motion.div>

          {/* Card 2 — animated % counter */}
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className={`${card} bg-primary-950 border-primary-900 text-white flex flex-col justify-between min-h-[200px]`}
          >
            <FiShield className="text-secondary-300" size={24} />
            <div>
              <div className="font-display text-5xl font-semibold leading-none">
                <CountUp end={100} suffix="%" />
              </div>
              <p className="text-dia-mint/80 text-sm mt-2">Authentic, brand-sourced products</p>
            </div>
          </motion.div>

          {/* Card 3 — slot ticker */}
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className={`${card} bg-secondary-500 border-secondary-400 text-ink-950 flex flex-col justify-between min-h-[200px]`}
          >
            <FiTruck size={24} className="text-ink-900/70" />
            <div>
              <div className="font-display text-5xl font-semibold leading-none tabular-nums">
                <Ticker from="15+" to="19+" />
              </div>
              <p className="text-ink-900/70 text-sm mt-2">Authorised brand partners on the shelf</p>
            </div>
          </motion.div>

          {/* Card 4 — mission text block (wide) */}
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className={`${card} md:col-span-2 bg-white border-gray-200 shadow-sm flex items-center`}
          >
            <p className="font-display text-xl sm:text-2xl text-ink-800 leading-snug">
              Helping families and clinics move from{' '}
              <span className="text-secondary-600 italic">confusion to confidence</span>{' '}
              — the right device, genuine and well-priced, every time.
            </p>
          </motion.div>

          {/* Card 5 — brand footer block (full width) */}
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className={`${card} md:col-span-3 bg-ink-950 border-ink-900 text-white relative overflow-hidden flex items-center justify-between gap-4`}
          >
            <div className="relative z-10">
              <div className="flex items-center gap-2">
                <FiActivity className="text-secondary-300" size={18} />
                <span className="text-xs uppercase tracking-[0.18em] text-dia-mint/70">One trusted partner</span>
              </div>
              <p className="font-display text-2xl sm:text-3xl font-semibold mt-2">
                One trusted partner for every device.
              </p>
            </div>
            {/* large faded brand mark */}
            <div className="relative z-10 opacity-90 shrink-0">
              <DiaShoppeLogo size={64} />
            </div>
            <div className="absolute -right-10 -bottom-12 opacity-[0.06] pointer-events-none">
              <span className="font-display text-[10rem] leading-none font-bold">DS</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
