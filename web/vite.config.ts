import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Mirror the Vercel edge function in api/rpc.js: same-origin JSON-RPC, no CORS.
    proxy: {
      "/api/rpc/mainnet": {
        target: "https://rpc.mainnet.chain.robinhood.com",
        changeOrigin: true,
        rewrite: () => "/",
      },
      "/api/rpc/testnet": {
        target: "https://rpc.testnet.chain.robinhood.com",
        changeOrigin: true,
        rewrite: () => "/",
      },
    },
  },
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
