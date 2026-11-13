import { Link, useLocation } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import PageBackground from '../components/PageBackground'
import { Reveal } from '../components/motion'
import { FiHome, FiShoppingBag, FiArrowLeft, FiAlertCircle } from 'react-icons/fi'

/*
  Catch-all 404 page (mounted on `*` in App.jsx). Keeps the standard
  PageBackground + Header + Footer shell so a mistyped URL still feels like
  part of the store, and points the visitor back to the pages that matter.
*/
export default function NotFound() {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen flex flex-col">
      <PageBackground />
      <Header showSearch />

      <main className="flex-1 flex items-center justify-center px-4 py-20 sm:py-28">
        <Reveal>
          <div className="max-w-xl mx-auto text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary-100 text-secondary-600">
              <FiAlertCircle className="h-10 w-10" />
            </div>

            <p className="font-display text-7xl sm:text-8xl font-semibold text-primary-900 leading-none">
              404
            </p>
            <h1 className="mt-4 font-display text-2xl sm:text-3xl font-semibold text-ink-900">
              This page took a wrong turn
            </h1>
            <p className="mt-3 text-gray-600 leading-relaxed">
              We couldn&rsquo;t find{' '}
              <span className="font-medium text-ink-800 break-all">{pathname}</span>. It may
              have moved, or the link might be mistyped. Let&rsquo;s get you back to the
              equipment you need.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/"
                className="inline-flex items-center gap-2 rounded-full bg-primary-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-900/20 transition-colors hover:bg-primary-800"
              >
                <FiHome className="h-4 w-4" /> Back to home
              </Link>
              <Link
                to="/products"
                className="inline-flex items-center gap-2 rounded-full border border-secondary-300 bg-white px-6 py-3 text-sm font-semibold text-primary-800 transition-colors hover:bg-secondary-50"
              >
                <FiShoppingBag className="h-4 w-4" /> Browse products
              </Link>
            </div>

            <button
              onClick={() => window.history.back()}
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-primary-700"
            >
              <FiArrowLeft className="h-4 w-4" /> Go back
            </button>
          </div>
        </Reveal>
      </main>

      <Footer />
    </div>
  )
}
