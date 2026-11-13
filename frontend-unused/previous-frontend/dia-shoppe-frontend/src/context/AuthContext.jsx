import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { identifyUser, resetAnalytics } from '../lib/analytics'
import { setSentryUser } from '../lib/sentry'
import { getFirstTouch } from '../lib/attribution'

/*
  Real Supabase auth. Session persistence + refresh is handled by the
  supabase-js client (localStorage). On sign-in we also load the user's
  user_profiles row — role ('admin' | 'customer') lives there, enforced
  server-side by RLS; isAdmin here only controls what UI is shown.

  Exposed user shape stays compatible with the old mock:
  { id, email, name, role }
*/
const AuthContext = createContext(null)

const toDisplayUser = (authUser, profile) => ({
  id: authUser.id,
  email: authUser.email,
  name:
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    authUser.user_metadata?.first_name ||
    authUser.email?.split('@')[0],
  role: profile?.role || 'customer',
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadProfile = async (authUser) => {
      if (!authUser) {
        if (!cancelled) setUser(null)
        return
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('first_name, last_name, role, source')
        .eq('id', authUser.id)
        .maybeSingle()
      if (!cancelled) {
        const displayUser = toDisplayUser(authUser, profile)
        setUser(displayUser)
        identifyUser(displayUser)
        setSentryUser(displayUser)
      }
      // Record where this customer first came from, once — so the Leads page
      // can show acquisition source. Only writes if not already set.
      if (profile && !profile.source) {
        const src = getFirstTouch()
        supabase.from('user_profiles')
          .update({ source: src.channel, source_detail: src.detail })
          .eq('id', authUser.id)
          .then(() => {})
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      loadProfile(session?.user).finally(() => {
        if (!cancelled) setLoading(false)
      })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      loadProfile(session?.user)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const login = async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message || null }
  }

  const signup = async ({ name, email, password }) => {
    const [firstName, ...rest] = (name || '').trim().split(/\s+/)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName || null, last_name: rest.join(' ') || null },
      },
    })
    // session is null when Supabase requires email confirmation before sign-in
    const needsConfirmation = !error && !data.session
    return { error: error?.message || null, needsConfirmation }
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null)
    resetAnalytics()
    setSentryUser(null)
  }

  const isAdmin = user?.role === 'admin'

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
