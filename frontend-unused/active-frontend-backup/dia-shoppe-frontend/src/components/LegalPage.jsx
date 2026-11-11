import { Link } from 'react-router-dom'
import Header from './Header'
import Footer from './Footer'
import PageBackdrop from './PageBackdrop'
import { Reveal } from './motion'
import { business, isTodo } from '../data/business'
import { FiChevronRight, FiHome, FiMail, FiPhone, FiMapPin } from 'react-icons/fi'

/*
  Shared shell for the Privacy / Terms / Refunds pages: navy backdrop, one
  readable white column, and the business contact block at the end.

  Placeholder business details render as a visible marker rather than a blank,
  so an unfilled address can't quietly ship to a page that Razorpay and Meta
  will read during verification.
*/

export function Val({ children }) {
  if (isTodo(children)) {
    return (
      <span className="bg-amber-100 text-amber-800 font-medium px-1.5 py-0.5 rounded">
        [to be filled: {String(children).replace(/^TODO:\s*/, '')}]
      </span>
    )
  }
  return <>{children}</>
}

export function Section({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl sm:text-2xl font-semibold text-ink-900 mb-3">{title}</h2>
      <div className="space-y-3 text-gray-600 leading-relaxed text-sm sm:text-base">{children}</div>
    </section>
  )
}

export default function LegalPage({ title, intro, children }) {
  return (
    <div className="min-h-screen">
      <PageBackdrop />
      <Header />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <nav className="flex items-center gap-1.5 text-sm text-blue-100/70 mb-6">
          <Link to="/" className="hover:text-white flex items-center gap-1"><FiHome size={14} /> Home</Link>
          <FiChevronRight size={14} className="opacity-50" />
          <span className="text-white font-medium">{title}</span>
        </nav>

        <Reveal>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white">{title}</h1>
          <p className="text-blue-100/80 mt-2">Last updated: {business.lastUpdated}</p>
        </Reveal>

        <Reveal className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-10 mt-6">
          {intro && <p className="text-gray-600 leading-relaxed mb-8">{intro}</p>}

          {children}

          <div className="border-t border-gray-100 pt-6 mt-8">
            <h2 className="font-display text-lg font-semibold text-ink-900 mb-3">Contact us</h2>
            <p className="text-sm text-gray-600 mb-3">
              Questions about this policy? Reach {business.legalName} at:
            </p>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <FiMail size={15} className="text-secondary-500 mt-0.5 shrink-0" />
                <a href={`mailto:${business.email}`} className="hover:text-primary-700">{business.email}</a>
              </li>
              <li className="flex items-start gap-2">
                <FiPhone size={15} className="text-secondary-500 mt-0.5 shrink-0" />
                <Val>{business.phone}</Val>
              </li>
              <li className="flex items-start gap-2">
                <FiMapPin size={15} className="text-secondary-500 mt-0.5 shrink-0" />
                <Val>{business.address}</Val>
              </li>
              {business.gstin && <li className="text-gray-500">GSTIN: {business.gstin}</li>}
            </ul>
          </div>
        </Reveal>
      </div>

      <Footer />
    </div>
  )
}
