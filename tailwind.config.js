/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        'canvas-2': 'rgb(var(--canvas-2) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-2': 'rgb(var(--accent-2) / <alpha-value>)',
        cyan: 'rgb(var(--cyan) / <alpha-value>)',
        brass: 'rgb(var(--brass) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'Cambria', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.375rem',
      },
      boxShadow: {
        pop: '0 24px 60px -20px rgb(2 4 10 / 0.85), 0 2px 8px -2px rgb(2 4 10 / 0.6), 0 0 0 1px rgb(var(--line-strong) / 0.9)',
        lift: '0 18px 44px -24px rgb(2 4 10 / 0.9), 0 1px 0 0 rgb(255 255 255 / 0.05) inset',
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 10px 40px -12px rgb(var(--accent) / 0.45)',
        'glow-sm': '0 0 14px -2px rgb(var(--accent) / 0.55)',
        inset: 'inset 0 1px 0 0 rgb(255 255 255 / 0.055)',
      },
      backgroundImage: {
        'accent-sweep': 'linear-gradient(135deg, rgb(var(--accent)) 0%, rgb(var(--accent-2)) 52%, rgb(var(--cyan)) 100%)',
        'brass-sweep': 'linear-gradient(135deg, rgb(var(--brass)) 0%, rgb(var(--warn)) 100%)',
        'sheen-top': 'linear-gradient(180deg, rgb(255 255 255 / 0.06), rgb(255 255 255 / 0) 45%)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'scale-in': {
          from: { opacity: 0, transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        },
        'slide-in': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        rise: { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        drift: {
          '0%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(-2.5%, 2%, 0) scale(1.07)' },
          '100%': { transform: 'translate3d(2%, -2.5%, 0) scale(1.03)' },
        },
        spin_slow: { to: { transform: 'rotate(360deg)' } },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--ok) / 0.5)' },
          '70%': { boxShadow: '0 0 0 6px rgb(var(--ok) / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--ok) / 0)' },
        },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-7px)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        // `both` is required: the keyframes carry the centring translate, so
        // without a fill mode the panel jumps off-screen when they finish
        'scale-in': 'scale-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in': 'slide-in 240ms cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.4s linear infinite',
        rise: 'rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both',
        drift: 'drift 26s ease-in-out infinite alternate',
        'spin-slow': 'spin_slow 7s linear infinite',
        'pulse-ring': 'pulse-ring 2.2s ease-out infinite',
        float: 'float 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
