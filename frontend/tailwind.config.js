/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        ember: "#c2410c",
        flax: "#f7e7b5",
        mist: "#dbeafe"
      },
      fontFamily: {
        display: ["Iowan Old Style", "Palatino Linotype", "serif"],
        body: ["Source Sans 3", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        panel: "0 24px 80px rgba(17, 24, 39, 0.16)"
      }
    }
  },
  plugins: []
};
