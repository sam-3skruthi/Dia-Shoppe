import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import PageBackdrop from '../components/PageBackdrop'
import { Reveal, motion } from '../components/motion'
import { useAuth } from '../context/AuthContext'
import { FiMail, FiLock, FiUser, FiLogIn, FiShield, FiCheck } from 'react-icons/fi'

function Field({ label, icon: Icon, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-white/85">{label}</span>
      <div className="mt-1 flex items-center border border-primary-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary-300 focus-within:border-primary-500 bg-white">
        {Icon && <span className="pl-3 text-primary-600"><Icon size={16} /></span>}
        <input {...props} className="flex-1 bg-transparent px-3 py-2.5 text-sm text-ink-950 outline-none placeholder:text-ink-800/40" />
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
        <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        {/* brand side — the site's existing promises, over the living backdrop */}
        <Reveal className="hidden lg:block">
          <span className="dia-label dia-glass inline-block rounded-full px-3.5 py-1.5">Dia Shoppe account</span>
          <h2 className="mt-5 font-heading text-5xl font-extrabold leading-[1.05] text-dia-ink">
            Medical equipment,<br />
            <span className="bg-gradient-to-r from-dia-cyan via-[#0288D1] to-dia-aqua bg-clip-text text-transparent">one sign-in away.</span>
          </h2>
          <p className="mt-4 max-w-md text-lg text-dia-ink/65">Track your orders, reorder in a tap and check out faster.</p>
          <ul className="mt-8 space-y-3">
            {['100% Authentic Products', 'Trusted Brand Partners', 'Expert Support Available', 'Delivered Across India'].map((t) => (
              <li key={t} className="flex items-center gap-3 font-semibold text-dia-ink/80">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-dia-aqua to-dia-cyan text-white shadow-[0_8px_20px_-8px_rgba(2,119,189,0.8)]">
                  <FiCheck size={16} aria-hidden="true" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="relative mx-auto w-full max-w-md">
          {/* soft electric-blue glow behind the card */}
          <div aria-hidden="true" className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(0,180,216,0.45),transparent)] blur-2xl" />
          <div className="relative overflow-hidden rounded-[28px] border border-[#90E0EF]/25 bg-[linear-gradient(155deg,#0277BD_0%,#05325A_42%,#021225_100%)] p-8 shadow-[0_40px_90px_-30px_rgba(0,119,189,0.65),0_0_0_1px_rgba(224,247,250,0.06)_inset] sm:p-10">
            <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(144,224,239,0.35),transparent)]" />
            {/* brand */}
            <div className="flex justify-center mb-6">
              <span className="rounded-full bg-white p-1.5 shadow-lg shadow-black/30"><img src="/logos/ds-emblem.png" alt="Dia Shoppe" className="h-12 w-auto" /></span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white text-center">
              {isSignup ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-white/65 text-center text-sm mt-1.5">
              {isSignup
                ? 'Sign up to track orders and check out faster.'
                : 'Sign in to view your orders and continue shopping.'}
            </p>

            {/* toggle */}
            <div className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/5 p-1 mt-6">
              <button
                type="button"
                onClick={() => setIsSignup(false)}
                className={`py-2 rounded-full text-sm font-semibold transition-colors ${!isSignup ? 'bg-white text-ink-950 shadow-sm' : 'text-white/60 hover:text-white'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setIsSignup(true)}
                className={`py-2 rounded-full text-sm font-semibold transition-colors ${isSignup ? 'bg-white text-ink-950 shadow-sm' : 'text-white/60 hover:text-white'}`}
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
                  <button type="button" className="text-xs text-dia-aqua font-medium hover:underline">Forgot password?</button>
                </div>
              )}

              {error && (
                <p className="text-sm text-red-200 bg-red-500/15 border border-red-400/30 rounded-lg px-3 py-2.5" role="alert">
                  {error}
                </p>
              )}

              {notice && (
                <p className="text-sm text-dia-tea bg-dia-cyan/20 border border-dia-cyan/40 rounded-lg px-3 py-2.5" role="status">
                  {notice}
                </p>
              )}

              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-dia-aqua to-[#0288D1] text-white font-semibold px-6 py-3.5 rounded-full shadow-lg shadow-dia-aqua/30 hover:brightness-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-dia-aqua/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FiLogIn size={18} /> {submitting ? 'Please wait…' : isSignup ? 'Create Account' : 'Sign In'}
              </motion.button>
            </form>

            <p className="text-center text-sm text-white/65 mt-6">
              {isSignup ? 'Already have an account?' : 'New to Dia Shoppe?'}{' '}
              <button
                type="button"
                onClick={() => setIsSignup(!isSignup)}
                className="text-dia-aqua font-semibold hover:underline"
              >
                {isSignup ? 'Sign in' : 'Create one'}
              </button>
            </p>

            <p className="flex items-center justify-center gap-1.5 text-xs text-white/40 mt-5">
              <FiShield size={13} /> Your account is secured with Supabase Auth.
            </p>
          </div>

          <p className="text-center text-sm text-dia-ink/65 mt-6">
            <Link to="/" className="hover:text-primary-700 transition-colors">← Back to home</Link>
          </p>
        </Reveal>
        </div>
      </div>

      <Footer />
    </div>
  )
}
