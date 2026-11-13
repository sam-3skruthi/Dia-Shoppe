import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
// both load on demand: Three.js / WebGL code never reaches phones or reduced-motion visitors
const DiaBackdrop = lazy(() => import('./DiaBackdrop'))
const SplashCursor = lazy(() => import('./bits/SplashCursor'))

/*
  The site-wide effects, decided per route:
    - DiaBackdrop (ghost fibers + the 3D D/S monogram they reveal): every page; quieter in admin.
    - SplashCursor (fluid ink following the cursor): customer pages only, never
      in admin; calmer on pages with forms (cart, checkout, login).
  Both are desktop-only (fine pointer, >= 768px) and off for reduced motion.
*/
const CALM = ['/cart', '/checkout', '/login', '/signup']

function useDesktopMotion() {
  const query = '(min-width: 768px) and (pointer: fine) and (prefers-reduced-motion: no-preference)'
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setOk(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return ok
}

export default function SiteEffects() {
  const { pathname } = useLocation()
  const admin = pathname.startsWith('/admin')
  const calm = CALM.some((p) => pathname.startsWith(p))
  const desktop = useDesktopMotion()
  const splash = desktop && !admin

  return (
    <>
      {desktop && (
        <Suspense fallback={null}>
          <DiaBackdrop intensity={admin ? 0.6 : 1} />
        </Suspense>
      )}
      {splash && (
        <Suspense fallback={null}>
          <SplashCursor
            rainbow={false}
            colors={['#0277BD', '#00B4D8', '#90E0EF']}
            colorSpeed={0.35}
            theme="light"
            intensity={calm ? 0.18 : 0.32}
            size={0.9}
            force={0.8}
            swirl={2.5}
            trail={calm ? 0.6 : 0.85}
            shading={0.6}
            quality="medium"
            clickSplash={!calm}
            intro={false}
            zIndex={30}
          />
        </Suspense>
      )}
    </>
  )
}
