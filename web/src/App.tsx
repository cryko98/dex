import { useEffect, useState } from "react";

import { Header, type Route } from "./components/Header";
import { Toasts } from "./components/Toasts";
import { deployedChainIds } from "./config/contracts";
import { hasRobinhoodConfig } from "./config/chains";
import { PoolPage } from "./pages/PoolPage";
import { SwapPage } from "./pages/SwapPage";
import { TokensPage } from "./pages/TokensPage";

const ROUTES: Route[] = ["swap", "pool", "tokens"];

function routeFromHash(): Route {
  const hash = window.location.hash.replace("#", "") as Route;
  return ROUTES.includes(hash) ? hash : "swap";
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);

  // Keep the hash and the view in step, so links and the back button work.
  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (next: Route) => {
    window.location.hash = next;
    setRoute(next);
  };

  const notConfigured = !hasRobinhoodConfig && deployedChainIds.length === 0;

  return (
    <div className="app">
      <Header route={route} onNavigate={navigate} />

      <main className={route === "swap" ? "main main--narrow" : "main"}>
        {notConfigured && <SetupNotice />}
        {route === "swap" && <SwapPage />}
        {route === "pool" && <PoolPage />}
        {route === "tokens" && <TokensPage />}
      </main>

      <footer className="footer">
        <div className="footer__inner">
          <span>Rho DEX · constant-product AMM · 0.30% fee to liquidity providers</span>
          <span>Not affiliated with Robinhood Markets, Inc.</span>
        </div>
      </footer>

      <Toasts />
    </div>
  );
}

/** Shown when neither a network nor a deployment has been configured yet. */
function SetupNotice() {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__title" style={{ marginBottom: 10 }}>
        Finish the setup
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        No network is configured and no contracts have been deployed yet. Copy{" "}
        <code className="mono">web/.env.example</code> to <code className="mono">web/.env</code> and fill in the
        Robinhood Chain RPC URL and chain id, then deploy the contracts:
      </p>
      <pre
        className="mono"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: 14,
          overflowX: "auto",
        }}
      >
        {`cd contracts
npm install
npm run build
npx hardhat node          # in a second terminal, for local testing
npm run deploy:local
npm run seed:local`}
      </pre>
    </div>
  );
}
