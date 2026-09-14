import { useEffect, useRef } from "react";

import type { IntervalKey } from "../hooks/usePoolCandles";

/**
 * Symbols TradingView carries for the assets this DEX lists. Anything not in this
 * map has no external market, so the UI falls back to the on-chain pool chart.
 */
const TV_SYMBOLS: Record<string, string> = {
  ETH: "ETHUSD",
  WETH: "ETHUSD",
  BTC: "BTCUSD",
  WBTC: "BTCUSD",
  SOL: "SOLUSD",
  DOGE: "DOGEUSD",
  LINK: "LINKUSD",
  AVAX: "AVAXUSD",
  MATIC: "MATICUSD",
  ARB: "ARBUSD",
};

const STABLES = new Set(["USDC", "USDT", "DAI", "USD", "FDUSD", "TUSD"]);

/** Maps a trading pair onto a TradingView symbol, or undefined if it has none. */
export function tradingViewSymbol(base: string | undefined, quote: string | undefined): string | undefined {
  if (!base || !quote) return undefined;

  const baseKey = base.toUpperCase();
  const quoteKey = quote.toUpperCase();

  // Only USD-quoted pairs map cleanly; token/token pairs have no listed equivalent.
  if (STABLES.has(quoteKey) && TV_SYMBOLS[baseKey]) return `CRYPTO:${TV_SYMBOLS[baseKey]}`;
  if (STABLES.has(baseKey) && TV_SYMBOLS[quoteKey]) return `CRYPTO:${TV_SYMBOLS[quoteKey]}`;
  return undefined;
}

const TV_INTERVALS: Record<IntervalKey, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1H": "60",
  "4H": "240",
  "1D": "D",
};

const SCRIPT_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

/** Embeds TradingView's Advanced Chart, themed to match the app. */
export function TradingViewWidget({ symbol, interval }: { symbol: string; interval: IntervalKey }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The embed script reads its config from the script tag it is appended next to,
    // so the whole widget has to be rebuilt whenever the symbol changes.
    container.innerHTML = "";
    const mount = document.createElement("div");
    mount.className = "tradingview-widget-container__widget";
    mount.style.height = "100%";
    container.appendChild(mount);

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: TV_INTERVALS[interval],
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(13, 13, 13, 1)",
      gridColor: "rgba(255, 255, 255, 0.04)",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [interval, symbol]);

  return (
    <div className="tv-widget">
      <div ref={containerRef} className="tradingview-widget-container" style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
