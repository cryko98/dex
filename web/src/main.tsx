import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { App } from "./App";
import { wagmiConfig } from "./config/wagmi";
import { SettingsProvider } from "./hooks/useSettings";
import { ToastProvider } from "./hooks/useToasts";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // Chain reads go stale quickly; the hooks set their own poll intervals.
      staleTime: 5_000,
    },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
