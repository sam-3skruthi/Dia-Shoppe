/** @type {import('tailwindcss').Config} */
/* Palette-derived scales (see PALETTE LOCK below). */
const BLUE_GREY = {
  50: '#EAF6FA', 100: '#DCEFF5', 200: '#C3E2EC', 300: '#9CC7D8', 400: '#6E9FB5',
  500: '#4E7F98', 600: '#3A6680', 700: '#284F68', 800: '#173A52', 900: '#0B2A44', 950: '#021225',
}
const BLUE_SCALE = {
  50: '#E0F7FA', 100: '#CAF0F8', 200: '#90E0EF', 300: '#5FD0E8', 400: '#00B4D8',
  500: '#0096C7', 600: '#0277BD', 700: '#02629C', 800: '#054F7E', 900: '#06304D', 950: '#021225',
}
const SKY_SCALE = {
  50: '#F0FBFD', 100: '#E0F7FA', 200: '#CAF0F8', 300: '#90E0EF', 400: '#48CAE4',
  500: '#00B4D8', 600: '#0096C7', 700: '#0277BD', 800: '#02629C', 900: '#054F7E', 950: '#06304D',
}
// former reds/pinks (errors, sale, delete): the strongest blues so they still stand out
const DEEP_SCALE = {
  50: '#E0F7FA', 100: '#CAF0F8', 200: '#90E0EF', 300: '#48CAE4', 400: '#0288D1',
  500: '#0277BD', 600: '#02629C', 700: '#054F7E', 800: '#06304D', 900: '#021225', 950: '#021225',
}

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        /* Global type system (revamp): DM Sans for body/UI everywhere, Manrope
           for every heading (font-display is used by all pages' headings). */
        sans: ['"DM Sans"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Manrope', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        doodle: ['Caveat', 'Comic Sans MS', 'cursive'],
        /* Revamp type system (homepage first): Manrope headings, DM Sans
           body/UI, IBM Plex Mono for technical labels. Additive — the legacy
           `sans` / `display` families above are untouched. */
        heading: ['Manrope', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        /* NOT named `mono`: that would override Tailwind's default `font-mono`,
           which existing pages (OrderConfirmation, admin) already use. */
        tech: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        /* ── PALETTE LOCK (Nov 2026) ──────────────────────────────────────
           The owner wants ONLY the Dolphin Dive palette on screen. Rather than
           hunt every class, Tailwind's built-in colour families are redefined
           here as scales derived from the palette, so any gray-*, green-*,
           amber-*, red-*, white, black ... class anywhere in the app (store
           and admin) renders in palette colours.
             Deep Blue #0277BD · Electric Blue #00B4D8 · Light Sky #90E0EF
             Icy Pale #E0F7FA · Ink #021225 (text / darkest)               */
        white: '#E0F7FA',
        black: '#021225',
        gray: BLUE_GREY, slate: BLUE_GREY, zinc: BLUE_GREY, neutral: BLUE_GREY, stone: BLUE_GREY,
        green: BLUE_SCALE, emerald: BLUE_SCALE, teal: BLUE_SCALE, lime: BLUE_SCALE,
        cyan: SKY_SCALE, sky: SKY_SCALE, amber: SKY_SCALE, yellow: SKY_SCALE, orange: SKY_SCALE,
        blue: BLUE_SCALE, indigo: BLUE_SCALE, violet: BLUE_SCALE, purple: BLUE_SCALE,
        red: DEEP_SCALE, rose: DEEP_SCALE, pink: DEEP_SCALE, fuchsia: DEEP_SCALE,
        /* ── Diashoppe revamp palette (approved brand foundation) ──
           Namespaced under `dia` so it never collides with the legacy
           primary / ink / secondary scales still used by other pages. */
        dia: {
          /* Dolphin Dive palette (approved Nov 2026). Token NAMES are kept so
             every existing class follows the new colours automatically. */
          mint: '#E0F7FA',   // Icy Pale Blue - main light surface
          tea: '#90E0EF',    // Light Sky Blue - soft highlight surface
          aqua: '#00B4D8',   // Electric Blue - action / light accent
          cyan: '#0277BD',   // Deep Blue - accent text, icons, buttons
          ink: '#021225',    // Ink - headings, dark sections (unchanged)
          /* atmospheric accents */
          emerald: '#0096C7',
          turquoise: '#48CAE4',
          pale: '#CAF0F8',
          violet: '#0277BD', // former violet shadow tint, now deep blue
        },
        canvas: '#E0F7FA',            // Icy Pale Blue
        /* primary = Deep Blue family (buttons, links, focus). 700 is the exact Deep Blue. */
        primary: {
          50:  '#EEF8FD',
          100: '#D6EEFA',
          200: '#ADDCF3',
          300: '#7CC6EA',
          400: '#42A9DD',
          500: '#1590CF',
          600: '#0284C7',
          700: '#0277BD',
          800: '#02629C',
          900: '#054F7E',
          950: '#06304D',
        },
        /* ink = dark navy family (dark sections, headings). */
        ink: {
          800: '#0B2A44',
          900: '#061B33',
          950: '#021225',
        },
        /* secondary = sky / electric-blue accent (badges, highlights). 200 is Light Sky Blue. */
        secondary: {
          50:  '#F0FBFD',
          100: '#E0F7FA',
          200: '#90E0EF',
          300: '#6CD3EA',
          400: '#33C3E2',
          500: '#00B4D8',
          600: '#0096B8',
          700: '#077894',
          800: '#0B5F75',
          900: '#0D4E60',
        },
      },
      keyframes: {
        marquee: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        /* same loop, travelling left → right */
        'marquee-reverse': {
          '0%':   { transform: 'translateX(-50%)' },
          '100%': { transform: 'translateX(0)' },
        },
        blob: {
          '0%, 100%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%':      { transform: 'translate(24px, -28px) scale(1.08)' },
          '66%':      { transform: 'translate(-18px, 18px) scale(0.95)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        /* Slow cinematic zoom/pan for the hero background photo ("video feel") */
        kenburns: {
          '0%':   { transform: 'scale(1) translate(0, 0)' },
          '100%': { transform: 'scale(1.15) translate(-1.5%, -1.5%)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        marquee: 'marquee 28s linear infinite',
        'marquee-reverse': 'marquee-reverse 28s linear infinite',
        'blob-slow':   'blob 14s ease-in-out infinite',
        'blob-slower': 'blob 20s ease-in-out infinite',
        'float-slow':  'float 6s ease-in-out infinite',
        shimmer:       'shimmer 1.6s infinite',
        kenburns:      'kenburns 20s ease-out infinite alternate',
        'fade-up':     'fade-up 0.8s ease-out both',
      },
    },
  },
  plugins: [],
}
