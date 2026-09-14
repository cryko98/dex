import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    target: "es2020",
    outDir: "dist",
    rollupOptions: {
      output: {
        // Keep the wallet stack and the charting library out of the initial chunk.
        manualChunks: {
          react: ["react", "react-dom"],
          charts: ["lightweight-charts"],
          wallet: ["wagmi", "viem", "@tanstack/react-query"],
        },
      },
    },
  },
});
