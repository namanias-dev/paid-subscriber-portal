import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Light theme tokens
        canvas: "#FFFFFF",
        surface: "#F5F7FA",
        surface2: "#FBFCFE",
        ink: "#1A1A1A",
        ink2: "#5A6472",
        muted: "#8A93A2",
        primary: "#0057FF",
        "primary-hover": "#0046CC",
        "primary-tint": "#EAF1FF",
        success: "#16A34A",
        warning: "#F59E0B",
        danger: "#DC2626",
        saffron: "#FF9933",
        india: "#138808",
        line: "#E5E9F0",
        "line-strong": "#D5DBE6",
      },
      fontFamily: {
        heading: ["var(--font-sora)", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderColor: {
        DEFAULT: "#E5E9F0",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "20px",
      },
      boxShadow: {
        soft: "0 1px 3px rgba(16,24,40,0.06), 0 8px 24px rgba(16,24,40,0.06)",
        "soft-sm": "0 1px 3px rgba(16,24,40,0.06)",
        "soft-lg": "0 12px 40px rgba(16,24,40,0.10)",
        focus: "0 0 0 4px rgba(0,87,255,0.12)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "fade-in": "fade-in 0.4s ease-out both",
        float: "float 5s ease-in-out infinite",
        shimmer: "shimmer 1.4s linear infinite",
        "spin-slow": "spin-slow 28s linear infinite",
        marquee: "marquee 28s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
