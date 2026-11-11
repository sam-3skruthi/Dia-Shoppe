import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

/*
  Gate for /admin/* routes.
  - not logged in  → send to /login (remember where they were headed)
  - logged in, not admin → send home (they simply don't see the admin exists)

  NOTE: this is a client-side UI guard only — fine for this frontend prototype,
  but NOT real security. Once the backend exists, the admin role is enforced by
  Supabase Row-Level Security on the server so it can't be bypassed.
*/
export default function AdminRoute({ children }) {
  const { user, isAdmin, loading } = useAuth()
  const location = useLocation()

  // session is still being restored from storage — don't redirect yet
  if (loading) return null

  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!isAdmin) return <Navigate to="/" replace />
  return children
}
