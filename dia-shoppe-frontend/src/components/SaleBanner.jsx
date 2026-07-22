import { FiTag } from 'react-icons/fi'
import { useCatalog } from '../context/CatalogContext'

/*
  Slim marketing strip shown only while a sale event is active (see
  CatalogContext + lib/sale.js). Renders nothing outside the sale window —
  no admin cleanup needed when it ends.
*/
export default function SaleBanner() {
  const { saleEvent, saleMode } = useCatalog()
  if (!saleMode) return null

  // Admin forced the sale theme on without an actual sale event — show a
  // generic strip so the switch is visibly reflected on the storefront.
  if (!saleEvent) {
    return (
      <div className="bg-gradient-to-r from-primary-800 via-primary-700 to-secondary-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-center gap-2 text-sm font-medium text-center">
          <FiTag size={15} className="shrink-0" />
          <span><strong>Sale is live</strong> — special prices across the store</span>
        </div>
      </div>
    )
  }

  const endDate = new Date(saleEvent.ends_at ?? saleEvent.endsAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  })

  return (
    <div className="bg-gradient-to-r from-primary-800 via-primary-700 to-secondary-600 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-center gap-2 text-sm font-medium text-center">
        <FiTag size={15} className="shrink-0" />
        <span>
          <strong>{saleEvent.name}</strong>
          {saleEvent.banner_text || saleEvent.bannerText ? ` — ${saleEvent.banner_text || saleEvent.bannerText}` : ''}
        </span>
        <span className="hidden sm:inline text-white/70">· Ends {endDate}</span>
      </div>
    </div>
  )
}
