export default {
  content: [
    "./assets/**/*.{js,ts,jsx,tsx}",
    "./templates/**/*.html.twig"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#09202a",
        lagoon: "#0b5f6f",
        tide: "#19a7ce",
        sand: "#f5dfb0",
        kelp: "#1f5136"
      },
      boxShadow: {
        glow: "0 28px 80px rgba(13, 83, 103, 0.22)"
      }
    }
  },
  plugins: []
};
