import { formatUnits, parseUnits } from "viem";

/** Parses user input safely; returns 0n for empty or malformed values. */
export function parseAmount(value: string, decimals: number): bigint {
  const cleaned = value.trim().replace(/,/g, "");
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned)) return 0n;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  // Extra precision the token cannot represent is dropped rather than throwing.
  const truncated = fraction.slice(0, decimals);
  try {
    return parseUnits(`${whole || "0"}.${truncated || "0"}`, decimals);
  } catch {
    return 0n;
  }
}

/** Formats a raw amount for display: significant where small, grouped where large. */
export function formatAmount(value: bigint | undefined, decimals: number, maxFractionDigits = 6): string {
  if (value === undefined) return "-";
  if (value === 0n) return "0";

  const asNumber = Number(formatUnits(value, decimals));
  if (!Number.isFinite(asNumber)) return formatUnits(value, decimals);

  if (asNumber > 0 && asNumber < 0.000001) return "<0.000001";
  if (asNumber >= 1000) {
    return asNumber.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return trimZeros(asNumber.toFixed(Math.min(maxFractionDigits, decimals)));
}

/** Full precision, for the "max" button and copy-friendly values. */
export function formatExact(value: bigint, decimals: number): string {
  return trimZeros(formatUnits(value, decimals));
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "-";
  if (value > 0 && value < 0.01) return "<0.01%";
  return `${value.toFixed(digits)}%`;
}

export function shortenAddress(address: string, chars = 4): string {
  if (address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

/** Applies a slippage tolerance (in percent) as a floor or ceiling on an amount. */
export function applySlippage(amount: bigint, slippagePercent: number, direction: "min" | "max"): bigint {
  const bps = BigInt(Math.round(Math.max(0, slippagePercent) * 100));
  return direction === "min"
    ? (amount * (10_000n - bps)) / 10_000n
    : (amount * (10_000n + bps)) / 10_000n;
}

/** A unix deadline `minutes` from now, as the router expects. */
export function deadlineFromNow(minutes: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Math.round(minutes)) * 60);
}

/**
 * Price impact of a trade: how far the executed rate sits below the pool's
 * mid price, ignoring the fee. Returned as a percentage.
 */
export function priceImpactPercent(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): number {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0;

  const midPrice = Number(reserveOut) / Number(reserveIn);
  const executed = Number(amountOut) / Number(amountIn);
  if (!Number.isFinite(midPrice) || midPrice === 0) return 0;

  const impact = (1 - executed / midPrice) * 100;
  return impact > 0 ? impact : 0;
}

/** Human-readable exchange rate between two token amounts. */
export function exchangeRate(
  amountIn: bigint,
  decimalsIn: number,
  amountOut: bigint,
  decimalsOut: number,
): number | undefined {
  if (amountIn === 0n || amountOut === 0n) return undefined;
  const inValue = Number(formatUnits(amountIn, decimalsIn));
  const outValue = Number(formatUnits(amountOut, decimalsOut));
  if (!inValue) return undefined;
  return outValue / inValue;
}

export function formatRate(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return "-";
  if (rate >= 1000) return rate.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (rate < 0.0001) return rate.toExponential(2);
  return trimZeros(rate.toFixed(6));
}

/** Compact USD for table cells: $1.2K, $34.5M. */
export function formatCompactUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs < 0.01) return "<$0.01";
  if (abs < 1000) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}`;
}

/**
 * A token price in USD. Sub-cent prices need more decimals than the two a currency
 * formatter gives, so significant digits drive the precision instead.
 */
export function formatPriceUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (value >= 1) return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;

  const digits = Math.min(12, Math.max(4, Math.ceil(-Math.log10(value)) + 3));
  return `$${value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** Signed percentage for change columns. */
export function formatChange(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  if (Math.abs(value) >= 1000) return `${sign}${Math.round(value).toLocaleString("en-US")}%`;
  return `${sign}${value.toFixed(2)}%`;
}

/** Compact count: 1.2K txns. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value < 1000) return String(value);
  return value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

/** How long ago, as a short label: 4s, 12m, 3h, 5d. */
export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 365) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / (86400 * 365))}y`;
}

/** Token amounts already converted to a number, for the trade list. */
export function formatTokenAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs < 0.0001) return value.toExponential(2);
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return trimZeros(value.toFixed(4));
}
