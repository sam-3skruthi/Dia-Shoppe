import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/*
  Button system, adapted from the supplied source (Button / LiquidButton /
  MetalButton) to the Diashoppe palette and this project's Tailwind 3 setup.
  ADAPTED: shadcn colour tokens → dia.* tokens; LiquidButton renders any element
  via `as` (a router <Link>, <a> or <button>) because Radix Slot cannot wrap its
  multi-layer markup; the glass filter is defined once (<LiquidGlassDefs />) and
  falls back to a plain blur outside Chromium.
*/

/* ── Standard button ─────────────────────────────────────────────── */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all outline-none cursor-pointer focus-visible:ring-[3px] focus-visible:ring-dia-aqua/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-dia-ink text-dia-mint hover:bg-dia-cyan',
        aqua: 'bg-gradient-to-t from-dia-cyan to-dia-aqua text-white shadow-md shadow-dia-aqua/25 ring-1 ring-inset ring-white/25 hover:brightness-110 active:brightness-95',
        outline: 'border border-dia-cyan/40 bg-transparent text-dia-ink hover:bg-dia-tea',
        ghost: 'text-dia-ink hover:bg-dia-tea',
        link: 'text-dia-cyan underline-offset-4 hover:underline',
      },
      size: { default: 'h-10 px-5', sm: 'h-8 px-3 text-xs', lg: 'h-12 px-8 text-base', icon: 'h-10 w-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

const Button = React.forwardRef(function Button({ className, variant, size, asChild = false, ...props }, ref) {
  const Comp = asChild ? Slot : 'button'
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
})

/* ── Liquid glass button ─────────────────────────────────────────── */
const SHADOW_LIGHT =
  'shadow-[0_0_6px_rgba(2,18,37,0.04),0_2px_6px_rgba(2,18,37,0.10),inset_3px_3px_0.5px_-3px_rgba(2,18,37,0.5),inset_-3px_-3px_0.5px_-3px_rgba(2,18,37,0.45),inset_1px_1px_1px_-0.5px_rgba(2,18,37,0.3),inset_-1px_-1px_1px_-0.5px_rgba(2,18,37,0.3),inset_0_0_6px_6px_rgba(2,18,37,0.05),inset_0_0_2px_2px_rgba(2,18,37,0.03),0_0_12px_rgba(255,255,255,0.35)]'
const SHADOW_DARK =
  'shadow-[0_0_8px_rgba(0,0,0,0.03),0_2px_6px_rgba(0,0,0,0.08),inset_3px_3px_0.5px_-3.5px_rgba(255,255,255,0.09),inset_-3px_-3px_0.5px_-3.5px_rgba(255,255,255,0.85),inset_1px_1px_1px_-0.5px_rgba(255,255,255,0.6),inset_-1px_-1px_1px_-0.5px_rgba(255,255,255,0.6),inset_0_0_6px_6px_rgba(255,255,255,0.12),inset_0_0_2px_2px_rgba(255,255,255,0.06),0_0_12px_rgba(0,0,0,0.15)]'

const LIQUID_SIZES = {
  sm: 'h-9 px-5 text-sm',
  lg: 'h-12 px-8 text-[15px]',
  xl: 'h-14 px-10 text-base',
}
// tone = the surface the button sits on ("dark" = over the hero video)
const LIQUID_FILL = {
  'light-glass': 'bg-white/55',
  'light-accent': 'bg-dia-aqua/25',
  'dark-glass': 'bg-white/10',
  'dark-accent': 'bg-dia-aqua/35',
}

// backdrop-filter: url(#…) only renders in Chromium; elsewhere use a plain blur.
const isChromium = () =>
  typeof navigator !== 'undefined' && /\b(Chrome|Chromium|Edg)\//.test(navigator.userAgent) && !/\bOPR\//.test(navigator.userAgent)

const LiquidButton = React.forwardRef(function LiquidButton(
  { as: As = 'button', tone = 'light', variant = 'glass', size = 'lg', className, children, ...props },
  ref
) {
  const [chromium] = React.useState(isChromium)
  return (
    <As
      ref={ref}
      data-slot="liquid-button"
      className={cn(
        'relative isolate inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold outline-none transition duration-300 hover:scale-[1.04] active:scale-[0.98] focus-visible:ring-[3px] focus-visible:ring-dia-aqua/70 disabled:pointer-events-none disabled:opacity-50',
        LIQUID_SIZES[size],
        tone === 'dark' ? 'text-white' : 'text-dia-ink',
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 rounded-full transition-all', tone === 'dark' ? SHADOW_DARK : SHADOW_LIGHT)} />
      <span
        aria-hidden="true"
        className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-full backdrop-blur-md', LIQUID_FILL[`${tone}-${variant}`])}
        style={chromium ? { backdropFilter: 'url("#dia-liquid-glass") blur(1.5px)' } : undefined}
      />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </As>
  )
})

/** Render once on any page that uses <LiquidButton> (shared SVG filter). */
function LiquidGlassDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <filter id="dia-liquid-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="turbulence" />
          <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise" />
          <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="70" xChannelSelector="R" yChannelSelector="B" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation="4" result="finalBlur" />
          <feComposite in="finalBlur" in2="finalBlur" operator="over" />
        </filter>
      </defs>
    </svg>
  )
}

/* ── Metal button (supplied; no placement decided yet, so not used on Home) ── */
const METAL = {
  default: {
    outer: 'bg-gradient-to-b from-[#000] to-[#A0A0A0]',
    inner: 'bg-gradient-to-b from-[#FAFAFA] via-[#3E3E3E] to-[#E5E5E5]',
    button: 'bg-gradient-to-b from-[#B9B9B9] to-[#969696]',
    text: 'text-white [text-shadow:_0_-1px_0_rgb(80_80_80_/_100%)]',
  },
  primary: {
    outer: 'bg-gradient-to-b from-dia-ink to-dia-aqua',
    inner: 'bg-gradient-to-b from-dia-pale via-dia-cyan to-dia-tea',
    button: 'bg-gradient-to-b from-dia-aqua to-dia-cyan',
    text: 'text-white [text-shadow:_0_-1px_0_rgb(2_18_37_/_60%)]',
  },
}
const MetalButton = React.forwardRef(function MetalButton({ children, className, variant = 'default', ...props }, ref) {
  const c = METAL[variant] || METAL.default
  const [pressed, setPressed] = React.useState(false)
  return (
    <div
      className={cn('relative inline-flex transform-gpu rounded-md p-[1.25px] transition-transform duration-200', c.outer)}
      style={{ transform: pressed ? 'translateY(2px) scale(0.99)' : undefined }}
    >
      <div className={cn('absolute inset-[1px] rounded-lg', c.inner)} />
      <button
        ref={ref}
        className={cn('relative z-10 m-[1px] inline-flex h-11 cursor-pointer items-center justify-center overflow-hidden rounded-md px-6 text-sm font-semibold leading-none outline-none focus-visible:ring-[3px] focus-visible:ring-dia-aqua/70', c.button, c.text, className)}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        {...props}
      >
        {children}
      </button>
    </div>
  )
})

export { Button, LiquidButton, LiquidGlassDefs, MetalButton }
