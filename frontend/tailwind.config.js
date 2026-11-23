/** HaulGo design tokens */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidian: "#3A3541", graphite: "#4A4455", offwhite: "#FAF7F2", brand: "#A8651A", "brand-dark": "#8A5014", steel: "#7A7480",
        danger: "#D32F2F", "danger-dark": "#B71C1C",
        line: "#E8E2D8", "line-dark": "#5A5465",
      },
      fontFamily: { sans: ['"Manrope Variable"', "Inter", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(58,53,65,.05), 0 8px 24px -12px rgba(58,53,65,.18)", glow: "0 0 0 4px rgba(168,101,26,.16)" },
      keyframes: {
        rise: { "0%": { opacity: 0, transform: "translateY(14px) scale(.98)" }, "100%": { opacity: 1, transform: "none" } },
        pulseDot: { "0%,100%": { opacity: 1 }, "50%": { opacity: .35 } },
        sirenPulse: { "0%": { boxShadow: "0 0 0 0 rgba(211,47,47,.55)" }, "100%": { boxShadow: "0 0 0 18px rgba(211,47,47,0)" } },
        brandPulse: { "0%": { boxShadow: "0 0 0 0 rgba(168,101,26,.55)" }, "100%": { boxShadow: "0 0 0 18px rgba(168,101,26,0)" } },
        fadein: { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        roadMove: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-80px)" } },
      },
      animation: { rise: "rise .45s cubic-bezier(.2,.8,.2,1) both", pulseDot: "pulseDot 1.4s ease-in-out infinite", siren: "sirenPulse 1.4s ease-out infinite", brandRing: "brandPulse 1.4s ease-out infinite", road: "roadMove .5s linear infinite", fadein: "fadein 1.2s ease both" },
    },
  },
  plugins: [],
};
