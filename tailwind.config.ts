import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f5f2ea",
          100: "#e8e2d1",
          300: "#a89b78",
          500: "#5d513a",
          700: "#322a1d",
          900: "#1a1610",
        },
      },
      fontFamily: {
        serif: ['"Noto Serif KR"', "ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
