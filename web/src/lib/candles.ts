import type { PairTrade } from "../hooks/usePairStats";

export const INTERVALS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
} as const;

export type IntervalKey = keyof typeof INTERVALS;

export interface Candle {
  /** Unix seconds, bucket start. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base-token volume traded in the bucket. */
  volume: number;
}

/**
 * Buckets executed trades into OHLC candles.
 *
 * The price series is the pool's own fills, so every pair has a chart, including
 * tokens that no external price feed lists.
 */
export function tradesToCandles(trades: PairTrade[], interval: IntervalKey, useUsd = false): Candle[] {
  const seconds = INTERVALS[interval];
  const buckets = new Map<number, Candle>();

  // Trades arrive newest-first; candles need oldest-first.
  const ordered = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of ordered) {
    const price = useUsd ? trade.priceUsd : trade.price;
    if (price === undefined || !Number.isFinite(price) || price <= 0) continue;

    const bucket = Math.floor(trade.timestamp / seconds) * seconds;
    const existing = buckets.get(bucket);

    if (!existing) {
      buckets.set(bucket, {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: trade.baseAmount,
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume += trade.baseAmount;
    }
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/** Picks a candle interval that shows a useful amount of history for the data on hand. */
export function suggestInterval(trades: PairTrade[]): IntervalKey {
  if (trades.length < 2) return "1H";
  const span = trades[0].timestamp - trades[trades.length - 1].timestamp;
  if (span <= 3600 * 3) return "1m";
  if (span <= 3600 * 12) return "5m";
  if (span <= 86400 * 2) return "15m";
  if (span <= 86400 * 14) return "1H";
  return "1D";
}
