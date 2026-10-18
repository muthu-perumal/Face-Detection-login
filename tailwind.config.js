/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#0c121c',
          900: '#141c2b',
          800: '#1d283b',
          700: '#314158',
        },
        mist: '#f4f6f8',
        line: '#e4e8ee',
        pine: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          600: '#0f766e',
          700: '#0f766e',
          800: '#115e59',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px rgba(16, 24, 40, 0.04)',
      },
    },
  },
  plugins: [],
};
