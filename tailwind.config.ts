import type { Config } from "tailwindcss";

export default {
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["PPMori", "Inter", "system-ui", "sans-serif"],
        display: ["HelveticaNowDisplay", "PPMori", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Pennie raw brand colors — use as e.g. bg-pennie-beige, text-pennie-navy
        pennie: {
          white: "#FFFFFF",
          beige: "#F9F6F0",
          graphite: "#343434",
          navy: "#1D212F",
          "blue-light": "#ECF8FF",
          "blue-main": "#82D0FF",
          "blue-dark": "#439FE1",
          // Use for text/links on light surfaces — passes WCAG AA (≥4.5:1)
          // where blue-dark fails (3.16:1). Reserve blue-dark for fills/icons.
          "blue-deeper": "#1A6CA3",
          "green-light": "#F0F9F1",
          "green-main": "#86E7B3",
          "green-dark": "#55CF90",
          "yellow-light": "#FFF7E7",
          "yellow-main": "#FFD073",
          "yellow-dark": "#D69938",
          "peach-light": "#FFF5F2",
          "peach-main": "#FF966F",
          "peach-dark": "#E7704C",
          // Use for warning text on light surfaces — passes WCAG AA where
          // peach-dark fails (3.83:1). Reserve peach-dark for fills/icons.
          "peach-deeper": "#B8401C",
          "indigo-main": "#73A2FF",
          "indigo-dark": "#486CCA",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        // Pennie radii — never below 8px.
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "28px",
      },
      boxShadow: {
        resting: "0 2px 12px rgba(29, 33, 47, 0.07)",
        floating: "0 8px 32px rgba(29, 33, 47, 0.10)",
        elevated: "0 16px 48px rgba(29, 33, 47, 0.14)",
      },
      transitionTimingFunction: {
        "pennie-out": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pennie-rise": {
          from: { transform: "translateY(20px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pennie-rise": "pennie-rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
