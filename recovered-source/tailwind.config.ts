import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        muted: '#64748b',
        line: '#e7ebf2',
        brand: '#12b76a',
        brandSoft: '#eaf8f0',
        violet: '#7c3aed',
        danger: '#ff2d55',
        warn: '#f97316'
      },
      boxShadow: {
        panel: '0 10px 35px rgba(15, 23, 42, .06)'
      }
    }
  },
  plugins: []
};

export default config;
