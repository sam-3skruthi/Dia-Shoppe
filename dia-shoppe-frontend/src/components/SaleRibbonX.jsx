import { useCatalog } from '../context/CatalogContext'
import { FiStar } from 'react-icons/fi'

/*
  Sale-frontend piece #1 — two white ribbons crossed into an X, each with
  "SALE" text running along it (opposite directions). Sits in the gap between
  two landing-page sections. Only renders while the sale design is on.
*/

// one ribbon's worth of repeating "SALE" marks; duplicated for a seamless loop
function RibbonRun() {
  const unit = Array.from({ length: 12 })
  const Marks = () => (
    <div className="flex shrink-0 items-center">
      {unit.map((_, i) => (
        <span key={i} className="flex items-center gap-3 px-3">
          <span className="font-display text-lg sm:text-xl font-bold uppercase tracking-[0.25em] text-primary-900">
            Sale
          </span>
          <FiStar size={13} className="text-[color:var(--sale-accent,#0277BD)]" />
        </span>
      ))}
    </div>
  )
  return (
    <div className="flex w-max animate-marquee">
      <Marks />
      <Marks />
    </div>
  )
}

function Ribbon({ rotate, reverse }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 w-[150%]"
      style={{ transform: `translate(-50%, -50%) rotate(${rotate}deg)` }}
    >
      <div className="overflow-hidden border-y-2 border-[color:var(--sale-accent,#0277BD)] bg-white py-2 shadow-xl">
        <div className={reverse ? '[animation-direction:reverse]' : ''}>
          <RibbonRun />
        </div>
      </div>
    </div>
  )
}

export default function SaleRibbonX() {
  const { saleMode } = useCatalog()
  if (!saleMode) return null

  return (
    <section
      className="relative h-32 sm:h-40 overflow-hidden"
      aria-label="Sale is on"
    >
      {/* the two crossed ribbons */}
      <Ribbon rotate={-11} />
      <Ribbon rotate={11} reverse />
    </section>
  )
}
