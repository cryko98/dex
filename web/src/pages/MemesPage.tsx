import { useMemo, useState } from "react";

import { HeatBadge } from "../components/Heat";
import { RefreshIcon, SearchIcon, SpinnerIcon } from "../components/Icons";
import { TokenAvatar } from "../components/TokenAvatar";
import { TrendingBar } from "../components/TrendingBar";
import { TIMEFRAMES, type TimeframeKey } from "../hooks/useChainIndex";
import { useDex } from "../hooks/useDex";
import { WINDOWS, type WindowKey, type WindowStats } from "../hooks/usePairStats";
import { useSettings } from "../hooks/useSettings";
import { useTokenStats, type TokenStat } from "../hooks/useTokenStats";
import { categoryById } from "../lib/categories";
import { formatAge, formatChange, formatCompactUsd, formatCount, formatPriceUsd } from "../lib/format";

type SortKey = "heat" | "price" | "age" | "txns" | "volume" | "makers" | "liquidity" | "fdv" | WindowKey;
type Filter = "all" | "live" | "tradable" | "new" | "gainers" | "losers";

const FILTERS: { id: Filter; label: string; hint?: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live", hint: "Hides coins whose liquidity has been pulled." },
  { id: "tradable", label: "Tradable", hint: "Coins whose DEX router was found, so they can be swapped from their page." },
  { id: "new", label: "New" },
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
];

const WINDOW_KEYS = Object.keys(WINDOWS) as WindowKey[];
const TIMEFRAME_KEYS = Object.keys(TIMEFRAMES) as TimeframeKey[];
const NEW_TOKEN_SECONDS = 60 * 60 * 24;

interface Props {
  onOpenToken: (address: string) => void;
  /** Theme to start filtered on, from the trending bar elsewhere. */
  category?: string;
  onCategoryChange: (id: string | undefined) => void;
}

/** The memecoin screener: every community token trading on the chain right now. */
export function MemesPage({ onOpenToken, category, onCategoryChange }: Props) {
  const { chain } = useDex();
  const settings = useSettings();
  const {
    memes,
    memeTotals,
    categories,
    now,
    timeframe,
    coveredSeconds,
    requestedSeconds,
    truncated,
    isLoading,
    isRefreshing,
    error,
    refetch,
  } = useTokenStats();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "heat", desc: true });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = memes.filter((token) => {
      if (category && !token.categories.includes(category)) return false;
      if (!q) return true;
      return (
        token.symbol.toLowerCase().includes(q) ||
        token.name.toLowerCase().includes(q) ||
        token.address.toLowerCase() === q
      );
    });

    if (filter === "live") list = list.filter((t) => t.risk !== "rugged");
    if (filter === "tradable") list = list.filter((t) => t.tradable);
    if (filter === "new") list = list.filter((t) => t.createdAt > 0 && now - t.createdAt <= NEW_TOKEN_SECONDS);
    if (filter === "gainers") list = list.filter((t) => (t.windows[timeframe].change ?? 0) > 0);
    if (filter === "losers") list = list.filter((t) => (t.windows[timeframe].change ?? 0) < 0);

    const value = (token: TokenStat): number => {
      switch (sort.key) {
        case "heat":
          return token.heat;
        case "price":
          return token.priceUsd ?? 0;
        case "age":
          return token.createdAt || (sort.desc ? -Infinity : Infinity);
        case "txns":
          return token.buys + token.sells;
        case "volume":
          return token.volumeUsd;
        case "makers":
          return token.makers;
        case "liquidity":
          return token.liquidityUsd;
        case "fdv":
          return token.fdvUsd ?? 0;
        default:
          return token.windows[sort.key as WindowKey].change ?? 0;
      }
    };

    return [...list].sort((a, b) => (sort.desc ? value(b) - value(a) : value(a) - value(b)));
  }, [category, filter, memes, now, query, sort, timeframe]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: true }));

  const header = (key: SortKey, label: string) => (
    <th
      key={key}
      className="num"
      onClick={() => toggleSort(key)}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      title={`Sort by ${label}`}
    >
      {label}
      {sort.key === key && <span className="sort-caret">{sort.desc ? "▼" : "▲"}</span>}
    </th>
  );

  const activeCategory = category ? categoryById(category) : undefined;
  const partial = truncated && coveredSeconds < requestedSeconds;

  return (
    <>
      <div className="page-head row row--between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>Memecoins</h1>
          <p>
            Every community token trading on {chain?.name ?? "this network"} in the last {timeframe}, ranked by
            heat. Themes, volume and makers are computed from the chain, not a curated list.
          </p>
        </div>
        <button className="btn btn--sm" onClick={() => void refetch()} disabled={isRefreshing}>
          {isRefreshing ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
          Refresh
        </button>
      </div>

      <TrendingBar categories={categories} active={category} onSelect={onCategoryChange} timeframe={timeframe} />

      <div className="summary">
        <Tile label={`Memecoin volume ${timeframe}`} value={formatCompactUsd(memeTotals.volumeUsd)} accent />
        <Tile label="Memecoins active" value={String(memeTotals.count)} />
        <Tile label={`Transactions ${timeframe}`} value={formatCount(memeTotals.txns)} />
        <Tile label={`Makers ${timeframe}`} value={formatCount(memeTotals.makers)} />
        <Tile label="Memecoin liquidity" value={formatCompactUsd(memeTotals.liquidityUsd)} />
      </div>

      <div className="toolbar">
        <div className="search search--inline">
          <SearchIcon size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search memecoins by name, symbol or address"
            spellCheck={false}
          />
        </div>

        <div className="seg">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? "seg__item seg__item--active" : "seg__item"}
              onClick={() => setFilter(item.id)}
              title={item.hint}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="seg" title="How far back to scan the chain. Longer ranges take longer to load.">
          {TIMEFRAME_KEYS.map((key) => (
            <button
              key={key}
              className={timeframe === key ? "seg__item seg__item--active" : "seg__item"}
              onClick={() => settings.set({ timeframe: key })}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {activeCategory && (
        <div className="row" style={{ marginBottom: 12, gap: 8 }}>
          <span className="badge badge--lime">
            {activeCategory.emoji} {activeCategory.label}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => onCategoryChange(undefined)}>
            Clear theme
          </button>
        </div>
      )}

      {error && (
        <div className="banner banner--danger" style={{ marginTop: 0, marginBottom: 14 }}>
          Could not read the chain: {error.message}
        </div>
      )}

      {partial && !isLoading && (
        <div className="banner banner--info" style={{ marginTop: 0, marginBottom: 14 }}>
          The RPC caps how much log history it returns, so this covers the last{" "}
          <strong>{formatAge(coveredSeconds)}</strong> rather than the full {timeframe}. Longer windows are
          left blank rather than shown as understated numbers.
        </div>
      )}

      <div className="card" style={{ padding: "14px 0 6px" }}>
        {isLoading ? (
          <div className="empty">
            <SpinnerIcon size={20} />
            <div style={{ marginTop: 10 }}>Scanning the chain…</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            {query
              ? `Nothing matches "${query}".`
              : memes.length === 0
                ? "No memecoins traded in the scanned window."
                : "No memecoins match this filter."}
          </div>
        ) : (
          <div className="table-wrap table-wrap--flush">
            <table className="table table--explore">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 18 }}>#</th>
                  <th>Token</th>
                  {header("heat", "Heat")}
                  {header("price", "Price")}
                  {header("age", "Age")}
                  {header("txns", "Txns")}
                  {header("volume", "Volume")}
                  {header("makers", "Makers")}
                  {WINDOW_KEYS.map((key) => header(key, key))}
                  {header("liquidity", "Liquidity")}
                  {header("fdv", "FDV")}
                </tr>
              </thead>
              <tbody>
                {rows.map((token, index) => {
                  const isNew = token.createdAt > 0 && now - token.createdAt <= NEW_TOKEN_SECONDS;
                  const themes = token.categories.filter((id) => id !== "other").slice(0, 2);

                  return (
                    <tr key={token.address} onClick={() => onOpenToken(token.address)} style={{ cursor: "pointer" }}>
                      <td className="muted" style={{ paddingLeft: 18 }}>
                        {index + 1}
                      </td>
                      <td>
                        <span className="pair-cell">
                          <TokenAvatar symbol={token.symbol} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700 }}>{token.symbol}</span>
                              <span className="muted small">/{token.quoteSymbol}</span>
                              {isNew && <span className="badge badge--lime">NEW</span>}
                              {token.risk === "rugged" && (
                                <span
                                  className="badge badge--warn"
                                  title="Liquidity is gone while the coin still trades: anything bought now cannot be sold back."
                                >
                                  ⚠ rugged
                                </span>
                              )}
                              {token.risk === "thin" && (
                                <span className="badge" title="Under $5K liquidity; even small trades move the price.">
                                  thin liq
                                </span>
                              )}
                              {!token.tradable && (
                                <span className="badge" title="No verified router found for this DEX">
                                  view only
                                </span>
                              )}
                              {themes.map((id) => {
                                const theme = categoryById(id);
                                return (
                                  <span key={id} className="badge" title={theme.label}>
                                    {theme.emoji}
                                  </span>
                                );
                              })}
                            </span>
                            <span
                              className="muted small"
                              style={{
                                display: "block",
                                maxWidth: 220,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                fontWeight: 400,
                              }}
                            >
                              {token.name} · {token.dex}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="num">
                        <HeatBadge value={token.heat} />
                      </td>
                      <td className="num">{formatPriceUsd(token.priceUsd)}</td>
                      <td className="num muted">{token.createdAt > 0 ? formatAge(now - token.createdAt) : "—"}</td>
                      <td className="num">
                        <div>{formatCount(token.buys + token.sells)}</div>
                        <div className="small">
                          <span className="up">{formatCount(token.buys)}</span>
                          <span className="faint"> / </span>
                          <span className="down">{formatCount(token.sells)}</span>
                        </div>
                      </td>
                      <td className="num">{formatCompactUsd(token.volumeUsd)}</td>
                      <td className="num muted">{formatCount(token.makers)}</td>
                      {WINDOW_KEYS.map((key) => (
                        <ChangeCell key={key} window={token.windows[key]} />
                      ))}
                      <td className="num">{formatCompactUsd(token.liquidityUsd)}</td>
                      <td className="num">{formatCompactUsd(token.fdvUsd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function ChangeCell({ window }: { window: WindowStats }) {
  if (!window.covered) {
    return (
      <td className="num faint" title="Outside the scanned range">
        —
      </td>
    );
  }
  const value = window.change;
  const className = value === undefined ? "num muted" : value >= 0 ? "num up" : "num down";
  return <td className={className}>{formatChange(value)}</td>;
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="summary__tile" style={accent ? { borderColor: "rgba(204,255,0,0.35)" } : undefined}>
      <div className="summary__label">{label}</div>
      <div className="summary__value" style={accent ? { color: "var(--lime)" } : undefined}>
        {value}
      </div>
    </div>
  );
}
