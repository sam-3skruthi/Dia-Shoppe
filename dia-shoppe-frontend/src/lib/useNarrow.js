import { useEffect, useState } from 'react'

/** True below the breakpoint (default 640px); updates on resize. */
export function useNarrow(breakpoint = 640) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < breakpoint)
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < breakpoint)
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [breakpoint])
  return narrow
}
