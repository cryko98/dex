import { useMemo } from "react";
import type { Address } from "viem";

import { categorize, rankCategories, type CategoryStat } from "../lib/categories";
import { isCommunityToken } from "../lib/pricing";
import { TIMEFRAMES } from "./useChainIndex";
import { useDex } from "./useDex";
import { usePairStats, WINDOWS, type PairStat, type WindowKey, type WindowStats } from "./usePairStats";

/**
 * "rugged": liquidity is essentially gone while the coin still shows activity, so
 * anything bought now cannot be sold back. "thin": under $5K of liquidity, where a
 * modest trade moves the price a lot.
 */
export type TokenRisk = "rugged" | "thin";

export interface TokenStat {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  /** Price in USD, from the deepest pair. */
  priceUsd?: number;
  /** Price in the deepest pair's quote asset. */
  priceQuote: number;
  quoteSymbol: string;
  /** Summed across every pair the token trades in. */
  liquidityUsd: number;
  fdvUsd?: number;
  /** Activity in the selected timeframe, across all pairs. */
  volumeUsd: number;
  buys: number;
  sells: number;
  /** Distinct trader addresses across all pairs. */
  makers: number;
  /** Share of transactions that were buys, 0-1. */
  buyPressure: number;
  windows: Record<WindowKey, WindowStats>;
  pairs: PairStat[];
  /** The deepest pair, which drives price and chart. */
  primary: PairStat;
  createdAt: number;
  isMeme: boolean;
  categories: string[];
  /**
   * 0-100 composite of volume, transactions, makers and buy pressure, ranked against
   * everything else in the index. A screener-style "what is moving" number.
   */
  heat: number;
  dex: string;
  /** True when a verified router exists for the primary pair, so it can be swapped. */
  tradable: boolean;
  risk?: TokenRisk;
}

export interface MemeTotals {
  count: number;
  volumeUsd: number;
  txns: number;
  liquidityUsd: number;
  makers: number;
}

/**
 * Rolls pair statistics up to the token level, which is how people actually think
 * about a memecoin: one coin, possibly several pools. Adds the theme classification,
 * the heat score and the chain-wide memecoin totals.
 */
export function useTokenStats() {
  const { native } = useDex();
  const pairStats = usePairStats();
  const { stats, now, timeframe } = pairStats;

  const tokens = useMemo<TokenStat[]>(() => {
    if (stats.length === 0) return [];

    const wrappedSymbol = `W${native.symbol}`;
    const windowSeconds = TIMEFRAMES[timeframe];

    // --- group pairs by base token ---------------------------------------
    const groups = new Map<string, PairStat[]>();
    for (const stat of stats) {
      const key = stat.sides.baseToken.toLowerCase();
      const list = groups.get(key);
      if (list) list.push(stat);
      else groups.set(key, [stat]);
    }

    const built: Omit<TokenStat, "heat">[] = [];

    for (const [, pairs] of groups) {
      pairs.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
      const primary = pairs[0];
      const { sides, pool } = primary;

      const name = sides.baseIndex === 0 ? pool.name0 : pool.name1;
      const symbol = sides.baseSymbol;

      const windows = {} as Record<WindowKey, WindowStats>;
      for (const key of Object.keys(WINDOWS) as WindowKey[]) {
        windows[key] = aggregateWindow(pairs, key, now);
      }

      const active = windows[timeframe];
      const txns = active.buys + active.sells;

      // Trades touching this token in the timeframe, for the distinct-makers count.
      const makers = new Set<string>();
      const cutoff = now - windowSeconds;
      for (const pair of pairs) {
        for (const trade of pair.trades) {
          if (trade.timestamp < cutoff) break; // trades are newest-first
          if (!trade.viaRouter) makers.add(trade.maker.toLowerCase());
        }
      }

      const createdAts = pairs.map((p) => p.createdAt).filter((t) => t > 0);

      const liquidityUsd = pairs.reduce((sum, p) => sum + (p.liquidityUsd ?? 0), 0);
      const risk = assessRisk(liquidityUsd, active.volumeUsd, txns);

      built.push({
        address: sides.baseToken,
        symbol,
        name,
        decimals: sides.baseDecimals,
        priceUsd: primary.priceUsd,
        priceQuote: primary.price,
        quoteSymbol: sides.quoteSymbol,
        liquidityUsd,
        fdvUsd: primary.fdvUsd,
        volumeUsd: active.volumeUsd,
        buys: active.buys,
        sells: active.sells,
        makers: active.covered ? makers.size : 0,
        buyPressure: txns > 0 ? active.buys / txns : 0.5,
        windows,
        pairs,
        primary,
        createdAt: createdAts.length ? Math.min(...createdAts) : 0,
        isMeme: isCommunityToken(symbol, wrappedSymbol),
        categories: categorize(name, symbol),
        dex: pool.dex,
        tradable: !!pool.router,
        risk,
      });
    }

    return applyHeat(built);
  }, [native.symbol, now, stats, timeframe]);

  const memes = useMemo(() => tokens.filter((t) => t.isMeme), [tokens]);

  const memeTotals = useMemo<MemeTotals>(() => {
    const windowSeconds = TIMEFRAMES[timeframe];
    const cutoff = now - windowSeconds;
    const makers = new Set<string>();
    let volumeUsd = 0;
    let txns = 0;
    let liquidityUsd = 0;

    for (const token of memes) {
      volumeUsd += token.volumeUsd;
      txns += token.buys + token.sells;
      liquidityUsd += token.liquidityUsd;
      for (const pair of token.pairs) {
        for (const trade of pair.trades) {
          if (trade.timestamp < cutoff) break;
          if (!trade.viaRouter) makers.add(trade.maker.toLowerCase());
        }
      }
    }

    return { count: memes.length, volumeUsd, txns, liquidityUsd, makers: makers.size };
  }, [memes, now, timeframe]);

  const categories = useMemo<CategoryStat[]>(
    () =>
      rankCategories(
        memes.map((t) => ({
          symbol: t.symbol,
          categories: t.categories,
          volumeUsd: t.volumeUsd,
          txns: t.buys + t.sells,
          change: t.windows[timeframe].change,
        })),
      ),
    [memes, timeframe],
  );

  return { ...pairStats, tokens, memes, memeTotals, categories };
}

/** One token by address. */
export function useTokenStat(address: string | undefined) {
  const all = useTokenStats();
  const token = useMemo(
    () => (address ? all.tokens.find((t) => t.address.toLowerCase() === address.toLowerCase()) : undefined),
    [address, all.tokens],
  );
  return { ...all, token };
}

// ---------------------------------------------------------------------------

const RUG_LIQUIDITY_USD = 500;
const THIN_LIQUIDITY_USD = 5_000;

function assessRisk(liquidityUsd: number, volumeUsd: number, txns: number): TokenRisk | undefined {
  // Real activity against an empty pool is the signature of pulled liquidity.
  if (liquidityUsd < RUG_LIQUIDITY_USD && (volumeUsd > 1_000 || txns > 20)) return "rugged";
  if (liquidityUsd < THIN_LIQUIDITY_USD) return "thin";
  return undefined;
}

function aggregateWindow(pairs: PairStat[], key: WindowKey, now: number): WindowStats {
  const primary = pairs[0].windows[key];
  if (!primary.covered) return { volumeUsd: 0, buys: 0, sells: 0, makers: 0, covered: false };

  const cutoff = now - WINDOWS[key];
  const makers = new Set<string>();
  let volumeUsd = 0;
  let buys = 0;
  let sells = 0;

  for (const pair of pairs) {
    const win = pair.windows[key];
    volumeUsd += win.volumeUsd;
    buys += win.buys;
    sells += win.sells;
    for (const trade of pair.trades) {
      if (trade.timestamp < cutoff) break;
      if (!trade.viaRouter) makers.add(trade.maker.toLowerCase());
    }
  }

  // The deepest pair is the least manipulable price reference for the change.
  return { change: primary.change, volumeUsd, buys, sells, makers: makers.size, covered: true };
}

/**
 * Percentile-ranks each ingredient across the whole index, then blends them. Ranks
 * rather than raw values, so one whale pair cannot flatten everything else to zero.
 */
function applyHeat(tokens: Omit<TokenStat, "heat">[]): TokenStat[] {
  const rank = (pick: (t: Omit<TokenStat, "heat">) => number) => {
    const sorted = [...tokens].map(pick).sort((a, b) => a - b);
    const n = sorted.length;
    return (value: number) => {
      if (n <= 1) return 1;
      // Position of the first element >= value, as a share of the population.
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < value) lo = mid + 1;
        else hi = mid;
      }
      return lo / (n - 1);
    };
  };

  const volumeRank = rank((t) => t.volumeUsd);
  const txnRank = rank((t) => t.buys + t.sells);
  const makerRank = rank((t) => t.makers);

  return tokens.map((token) => {
    const score =
      0.4 * volumeRank(token.volumeUsd) +
      0.25 * txnRank(token.buys + token.sells) +
      0.2 * makerRank(token.makers) +
      0.15 * token.buyPressure;
    // A rugged coin can post huge volume on the way down; do not let it lead the board.
    const penalty = token.risk === "rugged" ? 0.35 : token.risk === "thin" ? 0.85 : 1;
    return { ...token, heat: Math.round(Math.max(0, Math.min(1, score * penalty)) * 100) };
  });
}
