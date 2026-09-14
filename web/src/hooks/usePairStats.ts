import { useMemo } from "react";
import type { Address } from "viem";

import { buildPriceMap, priceOf, resolveSides, type PairSides } from "../lib/pricing";
import { TIMEFRAMES, useChainIndex, type IndexedPool, type SwapEvent } from "./useChainIndex";
import { useDex } from "./useDex";
import { useSettings } from "./useSettings";

export const WINDOWS = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
} as const;

export type WindowKey = keyof typeof WINDOWS;

export interface WindowStats {
  /** Percentage price change across the window, or undefined with no data. */
  change?: number;
  volumeUsd: number;
  buys: number;
  sells: number;
  makers: number;
  /** False when the scan did not reach back far enough to fill this window. */
  covered: boolean;
}

export interface PairTrade {
  timestamp: number;
  txHash: string;
  maker: Address;
  /**
   * True when the recipient was a DEX router rather than a wallet: token-to-native
   * sells pay the router, which unwraps and forwards. The real trader is only in
   * the transaction itself, so these are labelled instead of guessed.
   */
  viaRouter: boolean;
  side: "buy" | "sell";
  baseAmount: number;
  quoteAmount: number;
  price: number;
  priceUsd?: number;
  usdValue?: number;
}

export interface PairStat {
  pool: IndexedPool;
  sides: PairSides;
  /** Base price in quote units, straight from the reserves. */
  price: number;
  priceUsd?: number;
  liquidityUsd?: number;
  fdvUsd?: number;
  createdAt: number;
  windows: Record<WindowKey, WindowStats>;
  trades: PairTrade[];
  totalTxns: number;
}

function toUnits(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

/**
 * Turns the raw chain index into the numbers the explorer shows: price, liquidity,
 * FDV, and per-window volume, transactions and price change.
 */
export function usePairStats() {
  const { native } = useDex();
  const { timeframe } = useSettings();
  const { data, isLoading, isFetching, error, refetch } = useChainIndex(timeframe);

  const pools = useMemo(() => data?.pools ?? [], [data]);
  const prices = useMemo(() => buildPriceMap(pools), [pools]);

  const stats = useMemo<PairStat[]>(() => {
    if (!data || pools.length === 0) return [];

    const wrappedSymbol = `W${native.symbol}`;
    const byPair = groupByPair(data.swaps);
    const now = data.headTimestamp;
    const routerAddresses = new Set(Object.values(data.routers).map((r) => r.address.toLowerCase()));

    return pools.map((pool) => {
      const sides = resolveSides(pool, wrappedSymbol);
      const baseReserve = toUnits(sides.baseReserve, sides.baseDecimals);
      const quoteReserve = toUnits(sides.quoteReserve, sides.quoteDecimals);
      const price = baseReserve > 0 ? quoteReserve / baseReserve : 0;

      const quoteUsd = priceOf(prices, sides.quoteToken);
      const baseUsd = priceOf(prices, sides.baseToken);
      const priceUsd = baseUsd ?? (quoteUsd !== undefined ? price * quoteUsd : undefined);

      const liquidityUsd =
        quoteUsd !== undefined && baseUsd !== undefined
          ? baseReserve * baseUsd + quoteReserve * quoteUsd
          : quoteUsd !== undefined
            ? quoteReserve * quoteUsd * 2
            : undefined;

      const baseSupply = toUnits(sides.baseSupply, sides.baseDecimals);
      const fdvUsd = priceUsd !== undefined && baseSupply > 0 ? baseSupply * priceUsd : undefined;

      const trades = buildTrades(byPair.get(pool.pair.toLowerCase()) ?? [], sides, quoteUsd, routerAddresses);

      return {
        pool,
        sides,
        price,
        priceUsd,
        liquidityUsd,
        fdvUsd,
        createdAt: pool.createdAt,
        windows: buildWindows(trades, now, price, data.coveredSeconds),
        trades,
        totalTxns: trades.length,
      };
    });
  }, [data, native.symbol, pools, prices]);

  return {
    stats,
    prices,
    now: data?.headTimestamp ?? Math.floor(Date.now() / 1000),
    /** How much history the scan actually reached, in seconds. */
    coveredSeconds: data?.coveredSeconds ?? 0,
    truncated: data?.truncated ?? false,
    timeframe,
    requestedSeconds: TIMEFRAMES[timeframe],
    isLoading,
    isRefreshing: isFetching && !isLoading,
    error,
    refetch,
  };
}

/** Stats for one pair, by its pool address. */
export function usePairStat(pair: string | undefined) {
  const all = usePairStats();

  const stat = useMemo(() => {
    if (!pair) return undefined;
    return all.stats.find((s) => s.pool.pair.toLowerCase() === pair.toLowerCase());
  }, [all.stats, pair]);

  return { ...all, stat };
}

/** Stats for the pool holding two tokens, in either order. */
export function usePairStatByTokens(tokenA: string | undefined, tokenB: string | undefined) {
  const all = usePairStats();

  const stat = useMemo(() => {
    if (!tokenA || !tokenB) return undefined;
    const a = tokenA.toLowerCase();
    const b = tokenB.toLowerCase();
    // Several DEXes can list the same pair; show the deepest one.
    return all.stats
      .filter((s) => {
        const t0 = s.pool.token0.toLowerCase();
        const t1 = s.pool.token1.toLowerCase();
        return (t0 === a && t1 === b) || (t0 === b && t1 === a);
      })
      .sort((x, y) => (y.liquidityUsd ?? 0) - (x.liquidityUsd ?? 0))[0];
  }, [all.stats, tokenA, tokenB]);

  return { ...all, stat };
}

// ---------------------------------------------------------------------------

function groupByPair(swaps: SwapEvent[]): Map<string, SwapEvent[]> {
  const map = new Map<string, SwapEvent[]>();
  for (const swap of swaps) {
    const key = swap.pair.toLowerCase();
    const list = map.get(key);
    if (list) list.push(swap);
    else map.set(key, [swap]);
  }
  return map;
}

/** Converts raw Swap events into base/quote oriented trades. */
function buildTrades(
  swaps: SwapEvent[],
  sides: PairSides,
  quoteUsd: number | undefined,
  routerAddresses: Set<string>,
): PairTrade[] {
  const trades: PairTrade[] = [];

  for (const swap of swaps) {
    const baseIn = sides.baseIndex === 0 ? swap.amount0In : swap.amount1In;
    const baseOut = sides.baseIndex === 0 ? swap.amount0Out : swap.amount1Out;
    const quoteIn = sides.quoteIndex === 0 ? swap.amount0In : swap.amount1In;
    const quoteOut = sides.quoteIndex === 0 ? swap.amount0Out : swap.amount1Out;

    // Base leaving the pool means someone bought it.
    const isBuy = baseOut > 0n;
    const baseAmount = toUnits(isBuy ? baseOut : baseIn, sides.baseDecimals);
    const quoteAmount = toUnits(isBuy ? quoteIn : quoteOut, sides.quoteDecimals);
    if (baseAmount <= 0 || quoteAmount <= 0) continue;

    const price = quoteAmount / baseAmount;
    if (!Number.isFinite(price) || price <= 0) continue;

    trades.push({
      timestamp: swap.timestamp,
      txHash: swap.txHash,
      maker: swap.maker,
      viaRouter: routerAddresses.has(swap.maker.toLowerCase()),
      side: isBuy ? "buy" : "sell",
      baseAmount,
      quoteAmount,
      price,
      priceUsd: quoteUsd !== undefined ? price * quoteUsd : undefined,
      usdValue: quoteUsd !== undefined ? quoteAmount * quoteUsd : undefined,
    });
  }

  // Newest first, which is how the transaction list reads.
  return trades.sort((a, b) => b.timestamp - a.timestamp);
}

function buildWindows(
  trades: PairTrade[],
  now: number,
  currentPrice: number,
  coveredSeconds: number,
): Record<WindowKey, WindowStats> {
  const result = {} as Record<WindowKey, WindowStats>;

  for (const [key, seconds] of Object.entries(WINDOWS) as [WindowKey, number][]) {
    // A window longer than the scan reached would understate volume, so mark it
    // uncovered rather than reporting a number that looks complete.
    if (seconds > coveredSeconds) {
      result[key] = { volumeUsd: 0, buys: 0, sells: 0, makers: 0, covered: false };
      continue;
    }

    const cutoff = now - seconds;
    const inWindow = trades.filter((t) => t.timestamp >= cutoff);

    let volumeUsd = 0;
    let buys = 0;
    let sells = 0;
    const makers = new Set<string>();

    for (const trade of inWindow) {
      if (trade.usdValue !== undefined) volumeUsd += trade.usdValue;
      if (trade.side === "buy") buys++;
      else sells++;
      if (!trade.viaRouter) makers.add(trade.maker.toLowerCase());
    }

    // The opening price is the trade just before the window, or the oldest inside it.
    const before = trades.find((t) => t.timestamp < cutoff);
    const openPrice = before?.price ?? inWindow[inWindow.length - 1]?.price;
    const change =
      openPrice && openPrice > 0 && currentPrice > 0 ? ((currentPrice - openPrice) / openPrice) * 100 : undefined;

    result[key] = { change, volumeUsd, buys, sells, makers: makers.size, covered: true };
  }

  return result;
}
