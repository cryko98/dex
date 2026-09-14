import type { Address } from "viem";

/**
 * The pool fields pricing needs. Kept structural so both indexed pools and pools read
 * through our own lens can be priced without one module depending on the other.
 */
export interface PricablePool {
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  reserve0: bigint;
  reserve1: bigint;
  supply0: bigint;
  supply1: bigint;
}

/** Symbols treated as $1. Everything else is priced relative to these through pools. */
const STABLES = new Set([
  "USDC",
  "USDT",
  "USDG", // Global Dollar, the stablecoin quoted on Robinhood Chain
  "DAI",
  "USDB",
  "USDS",
  "USDE",
  "USD1",
  "PYUSD",
  "RLUSD",
  "FDUSD",
  "TUSD",
  "GUSD",
  "USDP",
  "LUSD",
  "FRAX",
  "CRVUSD",
  "USDBC",
]);

/** How many times to walk the pool graph outward from the stables. */
const PRICING_PASSES = 4;

export interface PricedToken {
  price: number;
  /** USD liquidity of the pool the price came from; higher is more trustworthy. */
  confidence: number;
}

export type PriceMap = Map<string, PricedToken>;

export function isStable(symbol: string): boolean {
  return STABLES.has(symbol.toUpperCase());
}

/** Established assets, as opposed to the long tail of community tokens. */
const MAJORS = new Set([
  "ETH",
  "WETH",
  "BTC",
  "WBTC",
  "SOL",
  "WSOL",
  "BNB",
  "WBNB",
  "MATIC",
  "WMATIC",
  "AVAX",
  "WAVAX",
  "ARB",
  "OP",
  "LINK",
  "UNI",
  "AAVE",
  "HOOD",
]);

export function isMajor(symbol: string): boolean {
  return MAJORS.has(symbol.toUpperCase());
}

/**
 * A rough "is this a community token" test, used for the Memecoins filter.
 *
 * There is no on-chain marker for a memecoin, so this is a heuristic: anything that
 * is not a stablecoin, the wrapped native token, or a listed major asset.
 */
export function isCommunityToken(symbol: string, wrappedSymbol: string): boolean {
  const upper = symbol.toUpperCase();
  if (isStable(upper)) return false;
  if (upper === wrappedSymbol.toUpperCase()) return false;
  return !isMajor(upper);
}

function toUnits(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

/**
 * Derives a USD price for every token reachable from a stablecoin through the pools.
 *
 * Stables anchor at $1, then each pass prices the unknown side of any pool whose
 * other side is already priced. A token reached through several pools keeps the
 * price from the deepest one, so a thin pool cannot set the headline number.
 */
export function buildPriceMap(pools: PricablePool[]): PriceMap {
  const prices: PriceMap = new Map();

  for (const pool of pools) {
    if (isStable(pool.symbol0)) prices.set(pool.token0.toLowerCase(), { price: 1, confidence: Infinity });
    if (isStable(pool.symbol1)) prices.set(pool.token1.toLowerCase(), { price: 1, confidence: Infinity });
  }

  for (let pass = 0; pass < PRICING_PASSES; pass++) {
    let changed = false;

    for (const pool of pools) {
      const key0 = pool.token0.toLowerCase();
      const key1 = pool.token1.toLowerCase();
      const amount0 = toUnits(pool.reserve0, pool.decimals0);
      const amount1 = toUnits(pool.reserve1, pool.decimals1);
      if (amount0 <= 0 || amount1 <= 0) continue;

      const known0 = prices.get(key0);
      const known1 = prices.get(key1);

      // Price the unpriced side against the priced one, at the pool's current ratio.
      if (known0 && !isStable(pool.symbol1)) {
        const price = (amount0 / amount1) * known0.price;
        // Both sides are worth the same in a balanced pool, so depth = 2x one side.
        if (upgrade(prices, key1, price, amount0 * known0.price * 2)) changed = true;
      }
      if (known1 && !isStable(pool.symbol0)) {
        const price = (amount1 / amount0) * known1.price;
        if (upgrade(prices, key0, price, amount1 * known1.price * 2)) changed = true;
      }
    }

    if (!changed) break;
  }

  return prices;
}

function upgrade(prices: PriceMap, key: string, price: number, confidence: number): boolean {
  if (!Number.isFinite(price) || price <= 0) return false;
  const existing = prices.get(key);
  if (existing && existing.confidence >= confidence) return false;
  prices.set(key, { price, confidence });
  return true;
}

export function priceOf(prices: PriceMap, token: Address | string): number | undefined {
  return prices.get(token.toLowerCase())?.price;
}

/**
 * Which side of a pair is the asset being traded and which is what it is priced in.
 * Stables outrank the wrapped native token, which outranks everything else.
 */
export function quoteRank(symbol: string, wrappedSymbol: string): number {
  const upper = symbol.toUpperCase();
  if (isStable(upper)) return 3;
  if (upper === wrappedSymbol.toUpperCase()) return 2;
  return 1;
}

export interface PairSides {
  baseIndex: 0 | 1;
  quoteIndex: 0 | 1;
  baseSymbol: string;
  quoteSymbol: string;
  baseToken: Address;
  quoteToken: Address;
  baseDecimals: number;
  quoteDecimals: number;
  baseReserve: bigint;
  quoteReserve: bigint;
  baseSupply: bigint;
}

export function resolveSides(pool: PricablePool, wrappedSymbol: string): PairSides {
  const rank0 = quoteRank(pool.symbol0, wrappedSymbol);
  const rank1 = quoteRank(pool.symbol1, wrappedSymbol);
  // The higher-ranked side quotes the pair; ties fall back to token0 as the base.
  const quoteIndex: 0 | 1 = rank1 >= rank0 ? 1 : 0;
  const baseIndex: 0 | 1 = quoteIndex === 1 ? 0 : 1;

  const pick = <T>(index: 0 | 1, a: T, b: T) => (index === 0 ? a : b);

  return {
    baseIndex,
    quoteIndex,
    baseSymbol: pick(baseIndex, pool.symbol0, pool.symbol1),
    quoteSymbol: pick(quoteIndex, pool.symbol0, pool.symbol1),
    baseToken: pick(baseIndex, pool.token0, pool.token1),
    quoteToken: pick(quoteIndex, pool.token0, pool.token1),
    baseDecimals: pick(baseIndex, pool.decimals0, pool.decimals1),
    quoteDecimals: pick(quoteIndex, pool.decimals0, pool.decimals1),
    baseReserve: pick(baseIndex, pool.reserve0, pool.reserve1),
    quoteReserve: pick(quoteIndex, pool.reserve0, pool.reserve1),
    baseSupply: pick(baseIndex, pool.supply0, pool.supply1),
  };
}
