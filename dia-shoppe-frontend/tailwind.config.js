/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Marcellus', 'Georgia', 'Cambria', 'serif'],
        doodle: ['Caveat', 'Comic Sans MS', 'cursive'],
      },
      colors: {
        /* Editorial cool off-white canvas (the "grey" base) */
        canvas: '#f5f6f8',
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        /* Deep blue — used for cinematic hero overlay & dark sections */
        ink: {
          800: '#0b1f3a',
          900: '#081627',
          950: '#040d18',
        },
        /* Emerald/mint accent (was teal) — navy + emerald palette */
        secondary: {
          50:  '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
      },
      keyframes: {
        marquee: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
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
