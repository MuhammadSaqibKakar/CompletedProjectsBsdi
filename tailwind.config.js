/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-md': '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
        'card-hover': '0 6px 20px rgba(16,185,129,0.12), 0 2px 6px rgba(0,0,0,0.06)',
        'header': '0 4px 24px rgba(0,0,0,0.18)',
      },
    },
  },
  plugins: [],
}
