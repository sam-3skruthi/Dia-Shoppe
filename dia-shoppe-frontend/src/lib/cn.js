import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/* Class-name helper used by the revamp's Button components (replaces the
   shadcn-style `@/lib/utils` import in the supplied source). tailwind-merge
   is pinned to v2, which targets Tailwind 3 (v3 of the lib is Tailwind 4). */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
