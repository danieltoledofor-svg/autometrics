import type { Config } from "tailwindcss";

const config: Config = {
  // As classes dark: seguem o tema escolhido no Autometrics (<html data-theme>,
  // lib/theme.ts), não o tema do computador.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}", // Garante compatibilidade
    "./lib/**/*.{ts,tsx}", // classes dos selos de status (lib/campaignStatus.ts)
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Tokens do guia visual (DESIGN.md). Valores em app/globals.css, por tema.
        canvas: "rgb(var(--am-canvas) / <alpha-value>)",
        surface: {
          1: "rgb(var(--am-surface-1) / <alpha-value>)",
          2: "rgb(var(--am-surface-2) / <alpha-value>)",
          3: "rgb(var(--am-surface-3) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--am-line) / <alpha-value>)",
          strong: "rgb(var(--am-line-strong) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--am-ink) / <alpha-value>)",
          muted: "rgb(var(--am-ink-muted) / <alpha-value>)",
          subtle: "rgb(var(--am-ink-subtle) / <alpha-value>)",
          faint: "rgb(var(--am-ink-faint) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "rgb(var(--am-brand) / <alpha-value>)",
          hover: "rgb(var(--am-brand-hover) / <alpha-value>)",
          text: "rgb(var(--am-brand-text) / <alpha-value>)",
        },
        pos: "rgb(var(--am-pos) / <alpha-value>)",
        neg: "rgb(var(--am-neg) / <alpha-value>)",
        warn: "rgb(var(--am-warn) / <alpha-value>)",
        chart: {
          1: "rgb(var(--am-chart-1) / <alpha-value>)",
          2: "rgb(var(--am-chart-2) / <alpha-value>)",
          3: "rgb(var(--am-chart-3) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
export default config;