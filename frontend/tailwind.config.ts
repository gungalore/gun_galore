import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // No colour theme here on purpose. The palette is the Winkel token set in
  // app/globals.css, consumed as arbitrary values (bg-[var(--bg-card)]) or
  // inline styles, so mirroring it into Tailwind's theme would give every
  // colour two names and invite drift.
  //
  // This block used to carry create-next-app's scaffold:
  //     colors: { background: "var(--background)", foreground: "var(--foreground)" }
  // Neither --background nor --foreground was ever defined, so both utilities
  // resolved to an invalid value, and nothing in the app consumed
  // bg-background / text-foreground anyway. Removed 2026-08-27.
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;
