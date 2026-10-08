/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        arena: { 950: "#080d21", 900: "#0d1430", 800: "#141d3b", 700: "#202b50" },
        violet: "#9b7cff",
        cyan: "#32d6ff",
        lime: "#c8f66b",
        coral: "#ff6b7a"
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "sans-serif"],
        body: ["DM Sans", "ui-sans-serif", "sans-serif"]
      },
      borderRadius: { card: "20px", pill: "999px" },
      boxShadow: {
        glass: "0 24px 70px rgba(0, 0, 0, .28)",
        neon: "0 0 28px rgba(50, 214, 255, .22)",
        violet: "0 0 28px rgba(155, 124, 255, .24)"
      }
    }
  },
  plugins: []
};
