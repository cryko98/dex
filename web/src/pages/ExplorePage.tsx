import { useMemo, useState } from "react";

import { RefreshIcon, SearchIcon, SpinnerIcon } from "../components/Icons";
import { PairAvatars } from "../components/TokenAvatar";
import { TrendingBar } from "../components/TrendingBar";
import { TIMEFRAMES, type TimeframeKey } from "../hooks/useChainIndex";
import { useDex } from "../hooks/useDex";
import { usePairStats, WINDOWS, type PairStat, type WindowKey, type WindowStats } from "../hooks/usePairStats";
import { useSettings } from "../hooks/useSettings";
import { useTokenStats } from "../hooks/useTokenStats";
import { formatAge, formatChange, formatCompactUsd, formatCount, formatPriceUsd } from "../lib/format";
import { isCommunityToken } from "../lib/pricing";

type SortKey = "price" | "age" | "txns" | "volume" | "makers" | "liquidity" | "fdv" | WindowKey;
type Filter = "all" | "memes" | "gainers" | "losers" | "new";

const FILTERS: { id: Filter; label: string; hint?: string }[] = [
  { id: "all", label: "All" },
  {
    id: "memes",
    label: "Memecoins",
    hint: "Community tokens: anything that is not a stablecoin, the wrapped native token, or a listed major asset. Nothing on-chain marks a token as a memecoin, so this is a heuristic.",
  },
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "new", label: "New" },
];

const WINDOW_KEYS = Object.keys(WINDOWS) as WindowKey[];
const TIMEFRAME_KEYS = Object.keys(TIMEFRAMES) as TimeframeKey[];

/** A pool created within this window counts as new. */
const NEW_PAIR_SECONDS = 60 * 60 * 24;

interface Props {
  onOpenPair: (pair: string) => void;
  onOpenCategory: (id: string | undefined) => void;
}

export function ExplorePage({ onOpenPair, onOpenCategory }: Props) {
  const { chain, native } = useDex();
  const settings = useSettings();
  const {
    stats,
    now,
    timeframe,
    coveredSeconds,
    requestedSeconds,
    truncated,
    isLoading,
    isRefreshing,
    error,
    refetch,
  } = usePairStats();
  const { categories } = useTokenStats();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "liquidity", desc: true });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = stats.filter((stat) => {
      if (!q) return true;
      return (
        stat.sides.baseSymbol.toLowerCase().includes(q) ||
        stat.sides.quoteSymbol.toLowerCase().includes(q) ||
        stat.pool.pair.toLowerCase() === q ||
        stat.sides.baseToken.toLowerCase() === q ||
        stat.sides.quoteToken.toLowerCase() === q
      );
    });

    if (filter === "memes") {
      list = list.filter((s) => isCommunityToken(s.sides.baseSymbol, `W${native.symbol}`));
    }
    if (filter === "gainers") list = list.filter((s) => (s.windows[timeframe].change ?? 0) > 0);
    if (filter === "losers") list = list.filter((s) => (s.windows[timeframe].change ?? 0) < 0);
    if (filter === "new") list = list.filter((s) => s.createdAt > 0 && now - s.createdAt <= NEW_PAIR_SECONDS);

    const value = (stat: PairStat): number => {
      const win = stat.windows[timeframe];
      switch (sort.key) {
        case "price":
          return stat.priceUsd ?? stat.price;
        case "age":
          // 0 means unknown; keep those at the bottom in either direction.
          return stat.createdAt || (sort.desc ? -Infinity : Infinity);
        case "txns":
          return win.buys + win.sells;
        case "volume":
          return win.volumeUsd;
        case "makers":
          return win.makers;
        case "liquidity":
          return stat.liquidityUsd ?? 0;
        case "fdv":
          return stat.fdvUsd ?? 0;
        default:
          return stat.windows[sort.key as WindowKey].change ?? 0;
      }
    };

    return [...list].sort((a, b) => (sort.desc ? value(b) - value(a) : value(a) - value(b)));
  }, [filter, native.symbol, now, query, sort, stats, timeframe]);

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

  const totals = useMemo(() => {
    const volume = stats.reduce((sum, s) => sum + s.windows[timeframe].volumeUsd, 0);
    const liquidity = stats.reduce((sum, s) => sum + (s.liquidityUsd ?? 0), 0);
    const txns = stats.reduce((sum, s) => sum + s.windows[timeframe].buys + s.windows[timeframe].sells, 0);
    return { volume, liquidity, txns };
  }, [stats, timeframe]);

  const partial = truncated && coveredSeconds < requestedSeconds;

  return (
    <>
      <div className="page-head row row--between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>Explore</h1>
          <p>
            Live pairs on {chain?.name ?? "this network"}, read straight from the chain. Pools are found
            through on-chain events, so every DEX on the network shows up without being configured.
          </p>
        </div>
        <button className="btn btn--sm" onClick={() => void refetch()} disabled={isRefreshing}>
          {isRefreshing ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
          Refresh
        </button>
      </div>

      <TrendingBar categories={categories} onSelect={onOpenCategory} timeframe={timeframe} />

      <div className="summary">
        <SummaryTile label={`Volume ${timeframe}`} value={formatCompactUsd(totals.volume)} />
        <SummaryTile label="Liquidity indexed" value={formatCompactUsd(totals.liquidity)} />
        <SummaryTile label={`Transactions ${timeframe}`} value={formatCount(totals.txns)} />
        <SummaryTile label="Pairs" value={String(stats.length)} />
      </div>

      <div className="toolbar">
        <div className="search search--inline">
          <SearchIcon size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pairs, symbols or paste an address"
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
              : stats.length === 0
                ? "No pools traded in the scanned window."
                : "No pairs match this filter."}
          </div>
        ) : (
          <div className="table-wrap table-wrap--flush">
            <table className="table table--explore">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 18 }}>#</th>
                  <th>Pair</th>
                  <th>DEX</th>
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
                {rows.map((stat, index) => {
                  const win = stat.windows[timeframe];
                  const isNew = stat.createdAt > 0 && now - stat.createdAt <= NEW_PAIR_SECONDS;

                  return (
                    <tr
                      key={stat.pool.pair}
                      onClick={() => onOpenPair(stat.pool.pair)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="muted" style={{ paddingLeft: 18 }}>
                        {index + 1}
                      </td>
                      <td>
                        <span className="pair-cell">
                          <PairAvatars symbol0={stat.sides.baseSymbol} symbol1={stat.sides.quoteSymbol} />
                          <span>
                            <span style={{ fontWeight: 700 }}>{stat.sides.baseSymbol}</span>
                            <span className="muted">/{stat.sides.quoteSymbol}</span>
                            {isNew && (
                              <span className="badge badge--lime" style={{ marginLeft: 8 }}>
                                NEW
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={stat.pool.isRho ? "badge badge--lime" : "badge"}>{stat.pool.dex}</span>
                      </td>
                      <td className="num">{formatPriceUsd(stat.priceUsd)}</td>
                      <td className="num muted">
                        {stat.createdAt > 0 ? formatAge(now - stat.createdAt) : "—"}
                      </td>
                      <td className="num">
                        <div>{formatCount(win.buys + win.sells)}</div>
                        <div className="small">
                          <span className="up">{formatCount(win.buys)}</span>
                          <span className="faint"> / </span>
                          <span className="down">{formatCount(win.sells)}</span>
                        </div>
                      </td>
                      <td className="num">{formatCompactUsd(win.volumeUsd)}</td>
                      <td className="num muted">{formatCount(win.makers)}</td>
                      {WINDOW_KEYS.map((key) => (
                        <ChangeCell key={key} window={stat.windows[key]} />
                      ))}
                      <td className="num">{formatCompactUsd(stat.liquidityUsd)}</td>
                      <td className="num">{formatCompactUsd(stat.fdvUsd)}</td>
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

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary__tile">
      <div className="summary__label">{label}</div>
      <div className="summary__value">{value}</div>
    </div>
  );
}
