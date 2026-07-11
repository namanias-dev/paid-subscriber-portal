import type { Config } from "tailwindcss";

/** AIVA design system — navy, royal blue, gold, soft white. Premium CEO command center. */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0b1f4d",
          900: "#050d24",
          800: "#0a1a3f",
          700: "#0f2557",
          600: "#1e3a8a",
        },
        royal: {
          DEFAULT: "#0057ff",
          hover: "#0046cc",
          tint: "#12213f",
        },
        gold: {
          DEFAULT: "#c9a227",
          bright: "#f2c94c",
          soft: "#f6ecc9",
        },
        soft: "#eef2fb",
        ink: "#e8ecf6",
        muted: "#8b97b5",
        line: "#1c2b52",
        success: "#16a34a",
        warning: "#f59e0b",
        danger: "#dc2626",
        info: "#38bdf8",
      },
      fontFamily: {
        heading: ["var(--font-heading)", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { xl: "14px", "2xl": "22px" },
      boxShadow: {
        glow: "0 0 40px -8px rgba(0,87,255,0.45)",
        goldglow: "0 0 30px -6px rgba(201,162,39,0.45)",
        panel: "0 10px 40px -12px rgba(0,0,0,0.5)",
      },
      keyframes: {
        pulse2: { "0%,100%": { opacity: "0.5" }, "50%": { opacity: "1" } },
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        pulse2: "pulse2 2.4s ease-in-out infinite",
        floaty: "floaty 6s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
