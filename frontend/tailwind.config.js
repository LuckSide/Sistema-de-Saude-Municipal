/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sus: {
          950: "#06283D",
          900: "#0A3D62",
          800: "#0E4E7A",
          700: "#136294",
          100: "#DCEBF5",
          50: "#EEF5FA",
        },
        teal: {
          DEFAULT: "#00A896",
        },
        sand: {
          DEFAULT: "#F6F4EE",
          dark: "#E9E5D9",
        },
        ink: "#10222E",
      },
      fontFamily: {
        display: ["Sora", "sans-serif"],
        body: ["Public Sans", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,34,46,.06), 0 8px 24px -12px rgba(10,61,98,.25)",
      },
    },
  },
  plugins: [],
};
