/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#f0f4ff",
          100: "#e0eaff",
          400: "#7c93f9",
          500: "#4f6ef7",
          600: "#3b55e6",
          700: "#2d43cc",
          800: "#26379e",
        },
      },
    },
  },
  plugins: [],
};
