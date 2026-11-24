export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace']
      },
      colors: {
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        cardForeground: 'rgb(var(--card-foreground) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        mutedForeground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        primaryForeground: 'rgb(var(--primary-foreground) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accentSoft: 'rgb(var(--accent-soft) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        ink: 'rgb(var(--foreground) / <alpha-value>)',
        panel: 'rgb(var(--card) / <alpha-value>)',
        line: 'rgb(var(--border) / <alpha-value>)'
      },
      boxShadow: {
        panel: '0 12px 32px rgb(30 54 44 / 0.07)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.15), 0 14px 36px rgb(var(--panel-glow) / 0.14)',
        'glow-sm': '0 8px 24px rgb(var(--panel-glow) / 0.12)',
        'glow-accent': '0 0 24px rgb(var(--accent) / 0.24)',
        'glow-warning': '0 0 16px rgb(var(--warning) / 0.45)',
        'glow-danger': '0 0 18px rgb(var(--danger) / 0.55)',
        'card-hover': '0 18px 44px rgb(30 54 44 / 0.12)',
        lift: '0 18px 50px rgb(21 38 31 / 0.16)'
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' }
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--panel-glow) / 0.0)' },
          '50%': { boxShadow: '0 0 28px 2px rgb(var(--panel-glow) / 0.28)' }
        },
        'view-in': {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.995)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0px)' }
        },
        'ambient-shift': {
          '0%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(4%, 6%) scale(1.05)' },
          '100%': { transform: 'translate(-2%, 4%) scale(1)' }
        },
        'gradient-x': {
          '0%, 100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' }
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '0.85' }
        }
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out both',
        'slide-up': 'slide-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.8s linear infinite',
        float: 'float 7s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 3.5s ease-in-out infinite',
        'view-in': 'view-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'ambient-shift': 'ambient-shift 24s ease-in-out infinite alternate',
        'gradient-x': 'gradient-x 5s ease infinite',
        'pulse-glow': 'pulse-glow 3.5s ease-in-out infinite'
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
      },
      backgroundSize: {
        '200': '200% 200%'
      },
    }
  },
  plugins: []
};
