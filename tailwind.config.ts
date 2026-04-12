import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark guitar amp aesthetic
        'amp-bg': '#0a0a0a',
        'amp-panel': '#161616',
        'amp-panel-2': '#1f1f1f',
        'amp-border': '#2a2a2a',
        'amp-accent': '#f59e0b',
        'amp-accent-hover': '#fbbf24',
        'amp-accent-dim': '#b45309',
        'amp-text': '#e5e5e5',
        'amp-muted': '#737373',
        'amp-success': '#10b981',
        'amp-error': '#ef4444',
        string: '#9ca3af',
        fret: '#525252',
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Consolas',
          'ui-monospace',
          'monospace',
        ],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
