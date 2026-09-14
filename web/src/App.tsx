import { useCallback, useEffect, useState } from "react";
import { isAddress } from "viem";

import { Header, type Route } from "./components/Header";
import { Toasts } from "./components/Toasts";
import type { Token } from "./config/tokens";
import { ExplorePage } from "./pages/ExplorePage";
import { MemesPage } from "./pages/MemesPage";
import { PairPage } from "./pages/PairPage";
import { PoolPage } from "./pages/PoolPage";
import { SwapPage } from "./pages/SwapPage";
import { TokenPage } from "./pages/TokenPage";
import { TokensPage } from "./pages/TokensPage";

type View = { route: Route; pair?: string; token?: string; category?: string };

const ROUTES: Route[] = ["explore", "memes", "swap", "pool", "tokens"];

function viewFromHash(): View {
  const hash = window.location.hash.replace(/^#/, "");

  const [head, tail] = hash.split("/");
  if (head === "pair" && tail && isAddress(tail)) return { route: "explore", pair: tail };
  if (head === "token" && tail && isAddress(tail)) return { route: "memes", token: tail };
  if (head === "memes" && tail) return { route: "memes", category: tail };
  if (ROUTES.includes(head as Route)) return { route: head as Route };
  return { route: "explore" };
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [swapPair, setSwapPair] = useState<{ tokenIn: Token; tokenOut: Token } | undefined>();

  // Keep the hash and the view in step, so links and the back button work.
  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const go = useCallback((hash: string) => {
    window.location.hash = hash;
    setView(viewFromHash());
  }, []);

  const openPair = useCallback((pair: string) => go(`pair/${pair}`), [go]);
  const openToken = useCallback((token: string) => go(`token/${token}`), [go]);
  const openCategory = useCallback((id: string | undefined) => go(id ? `memes/${id}` : "memes"), [go]);

  const tradePair = useCallback(
    (tokenIn: Token, tokenOut: Token) => {
      setSwapPair({ tokenIn, tokenOut });
      go("swap");
    },
    [go],
  );

  const isPairView = view.route === "explore" && !!view.pair;
  const isTokenView = view.route === "memes" && !!view.token;
  const narrow = view.route === "swap";

  return (
    <div className="app">
      <Header route={view.route} onNavigate={(next) => go(next)} onOpenPair={openPair} />

      <main className={narrow ? "main main--narrow" : "main"}>
        {isPairView && view.pair && (
          <PairPage pair={view.pair} onBack={() => go("explore")} onTrade={tradePair} />
        )}
        {view.route === "explore" && !view.pair && (
          <ExplorePage onOpenPair={openPair} onOpenCategory={openCategory} />
        )}
        {isTokenView && view.token && (
          <TokenPage address={view.token} onBack={() => go("memes")} onOpenPair={openPair} />
        )}
        {view.route === "memes" && !view.token && (
          <MemesPage onOpenToken={openToken} category={view.category} onCategoryChange={openCategory} />
        )}
        {view.route === "swap" && <SwapPage initialPair={swapPair} onOpenPair={openPair} />}
        {view.route === "pool" && <PoolPage />}
        {view.route === "tokens" && <TokensPage />}
      </main>

      <footer className="footer">
        <div className="footer__inner">
          <span>Rho · constant-product AMM · 0.30% fee to liquidity providers</span>
          <span>Not affiliated with Robinhood Markets, Inc.</span>
        </div>
      </footer>

      <Toasts />
    </div>
  );
}

