import { useEffect, useMemo, useRef, useState } from "react";

import { usePairStats } from "../hooks/usePairStats";
import { formatChange, formatCompactUsd, formatPriceUsd } from "../lib/format";
import { SearchIcon } from "./Icons";
import { PairAvatars } from "./TokenAvatar";

const MAX_RESULTS = 8;

/** Header search across every pair the explorer knows about. */
export function GlobalSearch({ onOpenPair }: { onOpenPair: (pair: string) => void }) {
  const { stats, timeframe } = usePairStats();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      // "/" focuses search, the way most market screeners do.
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // With no query, suggest the deepest pairs.
      return [...stats].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)).slice(0, MAX_RESULTS);
    }
    return stats
      .filter(
        (stat) =>
          stat.sides.baseSymbol.toLowerCase().includes(q) ||
          stat.sides.quoteSymbol.toLowerCase().includes(q) ||
          stat.pool.pair.toLowerCase() === q ||
          stat.sides.baseToken.toLowerCase() === q ||
          stat.sides.quoteToken.toLowerCase() === q,
      )
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .slice(0, MAX_RESULTS);
  }, [query, stats]);

  const choose = (pair: string) => {
    onOpenPair(pair);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="global-search" ref={containerRef}>
      <div className="search search--header">
        <SearchIcon size={15} />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) choose(results[0].pool.pair);
          }}
          placeholder="Search tokens or pairs"
          spellCheck={false}
          aria-label="Search tokens or pairs"
        />
        <kbd className="kbd">/</kbd>
      </div>

      {open && (
        <div className="search-results">
          {results.length === 0 ? (
            <div className="empty" style={{ padding: "20px 16px" }}>
              {stats.length === 0 ? "Loading pairs…" : `Nothing matches "${query}".`}
            </div>
          ) : (
            results.map((stat) => {
              const change = stat.windows[timeframe].change;
              return (
                <button key={stat.pool.pair} className="token-row" onClick={() => choose(stat.pool.pair)}>
                  <PairAvatars symbol0={stat.sides.baseSymbol} symbol1={stat.sides.quoteSymbol} />
                  <span className="token-row__main">
                    <div className="token-row__symbol">
                      {stat.sides.baseSymbol}
                      <span className="muted">/{stat.sides.quoteSymbol}</span>
                    </div>
                    <div className="token-row__name">{formatCompactUsd(stat.liquidityUsd)} liquidity</div>
                  </span>
                  <span className="token-row__balance">
                    <div>{formatPriceUsd(stat.priceUsd)}</div>
                    <div className={change === undefined ? "small muted" : change >= 0 ? "small up" : "small down"}>
                      {formatChange(change)}
                    </div>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
