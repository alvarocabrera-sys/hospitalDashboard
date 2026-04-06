/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: 'var(--bg-app)',
          card: 'var(--bg-surface)',
          'card-hover': 'var(--bg-hover)',
          accent: 'var(--color-primary)',
          'accent-hover': 'var(--color-primary-hover)',
          'accent-active': 'var(--color-primary-active)',
          secondary: 'var(--blue-secondary)',
          tertiary: 'var(--blue-primary)',
          quaternary: 'var(--blue-soft)',
          text: 'var(--text-primary)',
        },
        fg: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        semantic: {
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          info: 'var(--info)',
        },
      },
      borderColor: {
        subtle: 'var(--border-color)',
      },
      ringColor: {
        brand: 'rgba(255, 106, 26, 0.35)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
