/** @type {import('tailwindcss').Config} */
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
        /* ── Diashoppe revamp palette (approved brand foundation) ──
           Namespaced under `dia` so it never collides with the legacy
           primary / ink / secondary scales still used by other pages. */
        dia: {
          mint: '#F2FFF6',   // Mint Cream — main light surface
          tea: '#CAFFDE',    // Tea Green — soft highlight surface
          aqua: '#25C5E9',   // Sky Aqua — action / light accent
          cyan: '#238689',   // Dark Cyan — accent text & icons
          ink: '#021225',    // Ink Black — headings, dark sections
          /* Atmospheric accents (aurora) — proposed, pending your sign-off */
          emerald: '#1FB98A',
          turquoise: '#2CD3C2',
          pale: '#BDF1F8',   // pale aqua
          violet: '#6B5BD6', // used only as a faint shadow tint
        },
        /* ── Legacy scale names, remapped to the Diashoppe brand ──
           Every page already styles itself with primary / secondary / ink /
           canvas, so remapping them here moves the whole app (storefront,
           auth, cart, orders, admin) onto one palette without touching logic. */
        canvas: '#F2FFF6',            // Mint Cream
        /* primary = Dark Cyan family (buttons, links, focus). 700 is the exact brand Dark Cyan. */
        primary: {
          50:  '#F0FBFA',
          100: '#DDF5F3',
          200: '#B7E9E7',
          300: '#86D6D5',
          400: '#55BFC0',
          500: '#33A5A8',
          600: '#2A9598',
          700: '#238689',
          800: '#1D6F72',
          900: '#18595C',
          950: '#0E3A3E',
        },
        /* ink = Ink Black family (dark sections, headings). 950 is the exact brand Ink Black. */
        ink: {
          800: '#0B2A44',
          900: '#061B33',
          950: '#021225',
        },
        /* secondary = mint / emerald-turquoise accent (badges, highlights). 200 is Tea Green. */
        secondary: {
          50:  '#EEFCF6',
          100: '#D3F8E8',
          200: '#CAFFDE',
          300: '#8EEBCB',
          400: '#4ED6B4',
          500: '#1FB89C',
          600: '#179882',
          700: '#15786A',
          800: '#145F56',
          900: '#124E48',
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
