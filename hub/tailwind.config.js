/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        hub: {
          bg: '#13151E',
          card: '#1B1F2E',
          surface: '#242A3A',
          border: 'rgba(255,255,255,0.08)',
          accent: '#818CF8',
          text: '#F2F4F8',
          muted: '#8B95B0',
          green: '#6EE7A8',
          yellow: '#FBBF5E',
          red: '#F87171',
        },
        tbane: {
          blue: '#0352A0',
          orange: '#F26522',
          green: '#00A857',
        },
        ruter: {
          red: '#E60000',
        },
      },
      borderRadius: {
        card: '20px',
        inner: '14px',
        pill: '100px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(0,0,0,0.15), 0 8px 32px rgba(0,0,0,0.12)',
      },
      letterSpacing: {
        label: '0.08em',
      },
    },
  },
  plugins: [],
}
