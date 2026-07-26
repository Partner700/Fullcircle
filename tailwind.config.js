/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Baloo 2"', 'system-ui', 'sans-serif'],
        sans: ['Nunito', 'system-ui', 'sans-serif'],
      },
      colors: {
        /* Background layers */
        navy: '#0F1929',
        'navy-2': '#162038',
        'navy-3': '#1C2A4A',
        'navy-4': '#243358',

        /* Royal blue (vibrant variant) */
        royal: '#2B3EE6',
        'royal-2': '#3B50F0',

        /* Periwinkle — primary UI chrome, fills, text-on-dark */
        peri: '#DDE3FF',
        'peri-2': '#BFC9FF',
        'peri-dim': '#8896CC',
        'peri-soft': 'rgba(221, 227, 255, 0.12)',

        /* Dove colors */
        'dove-white': '#FFFFFF',
        'dove-body': '#B8C5D6',
        'dove-wing': '#8FA3B8',
        'dove-beak': '#D4A854',
        'dove-foot': '#6B8098',
        'dove-cloud': '#7A8FA0',

        /* Text */
        ink: '#FFFFFF',
        'ink-dim': '#DDE3FF',
        stone: '#8896CC',
        'stone-dim': '#5A6A9A',

        /* Status — translucent tints */
        gold: '#F5B731',
        'gold-soft': 'rgba(245, 183, 49, 0.15)',
        sage: '#5BAD7F',
        'sage-soft': 'rgba(91, 173, 127, 0.15)',
        coral: '#E05252',
        'coral-soft': 'rgba(224, 82, 82, 0.15)',

        /* Card chrome */
        border: 'rgba(221, 227, 255, 0.12)',
        'border-bright': 'rgba(221, 227, 255, 0.25)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
