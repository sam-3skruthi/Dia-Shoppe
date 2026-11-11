import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import PageBackdrop from '../components/PageBackdrop'
import { Reveal, motion } from '../components/motion'
import { useAuth } from '../context/AuthContext'
import { FiMail, FiLock, FiUser, FiLogIn, FiShield } from 'react-icons/fi'

function Field({ label, icon: Icon, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      <div className="mt-1 flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-secondary-400 focus-within:border-secondary-400 bg-white">
        {Icon && <span className="pl-3 text-gray-400"><Icon size={16} /></span>}
        <input {...props} className="flex-1 px-3 py-2.5 text-sm outline-none" />
      </div>
    </label>
  )
}

export default function Login({ signup = false }) {
  const [isSignup, setIsSignup] = useState(signup)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { login, signup: doSignup } = useAuth()

  const redirectTo = location.state?.from || '/'

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    const data = Object.fromEntries(new FormData(e.target).entries())
    const { error: authError, needsConfirmation } = isSignup
      ? await doSignup({ name: data.name, email: data.email, password: data.password })
      : await login({ email: data.email, password: data.password })
    setSubmitting(false)
    if (authError) {
      setError(authError)
      return
    }
    if (needsConfirmation) {
      setNotice(`Almost there! We've sent a confirmation link to ${data.email}. Click it, then sign in.`)
      setIsSignup(false)
      return
    }
    navigate(redirectTo, { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col">
      <PageBackdrop />
      <Header />

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <Reveal className="w-full max-w-md">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-xl p-8 sm:p-10">
            {/* brand */}
            <div className="flex justify-center mb-6">
              <img src="/logos/ds-emblem.png" alt="Dia Shoppe" className="h-14 w-auto" />
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ink-900 text-center">
              {isSignup ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-gray-500 text-center text-sm mt-1.5">
              {isSignup
                ? 'Sign up to track orders and check out faster.'
                : 'Sign in to view your orders and continue shopping.'}
            </p>

            {/* toggle */}
            <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-full p-1 mt-6">
              <button
                type="button"
                onClick={() => setIsSignup(false)}
                className={`py-2 rounded-full text-sm font-semibold transition-colors ${!isSignup ? 'bg-white text-ink-900 shadow-sm' : 'text-gray-500'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setIsSignup(true)}
                className={`py-2 rounded-full text-sm font-semibold transition-colors ${isSignup ? 'bg-white text-ink-900 shadow-sm' : 'text-gray-500'}`}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4 mt-6">
              {isSignup && (
                <Field label="Full Name" name="name" icon={FiUser} required placeholder="Ramesh Kumar" />
              )}
              <Field label="Email Address" name="email" type="email" icon={FiMail} required placeholder="you@example.com" />
              <Field label="Password" name="password" type="password" icon={FiLock} required placeholder="••••••••" minLength={6} />

              {!isSignup && (
                <div className="text-right">
                  <button type="button" className="text-xs text-primary-700 font-medium hover:underline">Forgot password?</button>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5" role="alert">
                  {error}
                </p>
              )}

              {notice && (
                <p className="text-sm text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2.5" role="status">
                  {notice}
                </p>
              )}

              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 bg-primary-700 text-white font-semibold px-6 py-3.5 rounded-full hover:bg-primary-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FiLogIn size={18} /> {submitting ? 'Please wait…' : isSignup ? 'Create Account' : 'Sign In'}
              </motion.button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-6">
              {isSignup ? 'Already have an account?' : 'New to Dia Shoppe?'}{' '}
              <button
                type="button"
                onClick={() => setIsSignup(!isSignup)}
                className="text-primary-700 font-semibold hover:underline"
              >
                {isSignup ? 'Sign in' : 'Create one'}
              </button>
            </p>

            <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400 mt-5">
              <FiShield size={13} /> Your account is secured with Supabase Auth.
            </p>
          </div>

          <p className="text-center text-sm text-blue-100/70 mt-6">
            <Link to="/" className="hover:text-white transition-colors">← Back to home</Link>
          </p>
        </Reveal>
      </div>

      <Footer />
    </div>
  )
}
