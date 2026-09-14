import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";

import { routerAbi } from "../abi";
import { wrappedAddress, type Token } from "../config/tokens";
import { useDex } from "./useDex";
import { useTokenList } from "./useTokens";

export type TradeType = "exactIn" | "exactOut";

export interface Quote {
  /** Amounts per hop, as returned by the router. */
  amounts: readonly bigint[];
  /** Token addresses the trade routes through. */
  path: Address[];
  /** The amount the user did not type: output for exactIn, input for exactOut. */
  otherAmount: bigint;
  /** Percentage the executed rate sits below the pool mid price, fee excluded. */
  priceImpact: number;
  /** Total LP fee across the route, as a percentage. */
  lpFeePercent: number;
  hops: number;
}

/** How much smaller the reference trade is, for measuring price impact. */
const IMPACT_REFERENCE_DIVISOR = 1000n;

/**
 * Quotes a trade across every plausible route and returns the best one.
 * Routes that do not exist simply revert inside the multicall and are ignored.
 */
export function useSwapQuote(
  tokenIn: Token | undefined,
  tokenOut: Token | undefined,
  amount: bigint,
  tradeType: TradeType,
  /** Quote against another DEX's router instead of our own. */
  target?: { router: Address; weth: Address },
) {
  const dex = useDex();
  const router = target?.router ?? dex.router;
  const weth = target?.weth ?? dex.weth;
  const chainId = dex.chainId;
  const { tokens } = useTokenList();

  const paths = useMemo<Address[][]>(() => {
    if (!tokenIn || !tokenOut || !weth) return [];

    const from = wrappedAddress(tokenIn, weth);
    const to = wrappedAddress(tokenOut, weth);
    if (from.toLowerCase() === to.toLowerCase()) return [];

    const candidates: Address[][] = [[from, to]];

    // One hop through any other known token, deduped and excluding the endpoints.
    const intermediates = new Set<string>([weth.toLowerCase()]);
    for (const token of tokens) {
      if (!token.isNative) intermediates.add(token.address.toLowerCase());
    }
    intermediates.delete(from.toLowerCase());
    intermediates.delete(to.toLowerCase());

    for (const middle of intermediates) {
      candidates.push([from, middle as Address, to]);
    }
    return candidates;
  }, [tokenIn, tokenOut, tokens, weth]);

  const referenceAmount = amount > 0n ? amount / IMPACT_REFERENCE_DIVISOR : 0n;
  const functionName = tradeType === "exactIn" ? "getAmountsOut" : "getAmountsIn";
  const enabled = !!router && amount > 0n && paths.length > 0;

  const { data, isLoading, isFetching, error } = useReadContracts({
    contracts: enabled
      ? [
          ...paths.map((path) => ({
            address: router as Address,
            abi: routerAbi,
            functionName,
            args: [amount, path] as const,
            chainId,
          })),
          ...paths.map((path) => ({
            address: router as Address,
            abi: routerAbi,
            functionName,
            args: [referenceAmount, path] as const,
            chainId,
          })),
        ]
      : [],
    query: { enabled, refetchInterval: 12_000 },
  });

  const quote = useMemo<Quote | undefined>(() => {
    if (!data || paths.length === 0) return undefined;

    const primary = data.slice(0, paths.length);
    const reference = data.slice(paths.length);

    let bestIndex = -1;
    let bestAmounts: readonly bigint[] | undefined;

    primary.forEach((result, index) => {
      if (result.status !== "success") return;
      const amounts = result.result as unknown as readonly bigint[];
      if (!amounts?.length) return;

      const candidate = tradeType === "exactIn" ? amounts[amounts.length - 1] : amounts[0];
      if (candidate === 0n) return;

      if (bestAmounts === undefined) {
        bestIndex = index;
        bestAmounts = amounts;
        return;
      }
      const current = tradeType === "exactIn" ? bestAmounts[bestAmounts.length - 1] : bestAmounts[0];
      // Best = most received on exact-in, least spent on exact-out.
      const better = tradeType === "exactIn" ? candidate > current : candidate < current;
      if (better) {
        bestIndex = index;
        bestAmounts = amounts;
      }
    });

    if (bestIndex < 0 || !bestAmounts) return undefined;

    const path = paths[bestIndex];
    const hops = path.length - 1;
    const otherAmount = tradeType === "exactIn" ? bestAmounts[bestAmounts.length - 1] : bestAmounts[0];

    // Compare the executed rate against a trade small enough to sit at the mid price.
    // The 0.3% fee is present in both rates, so it cancels and only impact remains.
    let priceImpact = 0;
    const referenceResult = reference[bestIndex];
    if (referenceResult?.status === "success" && referenceAmount > 0n) {
      const refAmounts = referenceResult.result as unknown as readonly bigint[];
      const refOther = tradeType === "exactIn" ? refAmounts[refAmounts.length - 1] : refAmounts[0];
      if (refOther > 0n) {
        const executed =
          tradeType === "exactIn" ? Number(otherAmount) / Number(amount) : Number(amount) / Number(otherAmount);
        const mid =
          tradeType === "exactIn"
            ? Number(refOther) / Number(referenceAmount)
            : Number(referenceAmount) / Number(refOther);
        if (Number.isFinite(executed) && Number.isFinite(mid) && mid > 0) {
          const impact = (1 - executed / mid) * 100;
          priceImpact = impact > 0 ? impact : 0;
        }
      }
    }

    // 0.3% compounds per hop: 1 - 0.997^hops.
    const lpFeePercent = (1 - 0.997 ** hops) * 100;

    return { amounts: bestAmounts, path: [...path], otherAmount, priceImpact, lpFeePercent, hops };
  }, [amount, data, paths, referenceAmount, tradeType]);

  const noRoute = enabled && !isLoading && !isFetching && !quote;

  return { quote, isLoading: isLoading || isFetching, noRoute, error };
}
