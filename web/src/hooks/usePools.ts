import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { lensAbi } from "../abi";
import { useDex } from "./useDex";

export interface Pool {
  pair: Address;
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  userLiquidity: bigint;
  /** The user's share of the pool, 0-1. */
  share: number;
}

const PAGE_SIZE = 200n;

/** Every pool on the active chain, with the connected wallet's LP balance filled in. */
export function usePools() {
  const { lens, chainId } = useDex();
  const { address } = useAccount();

  const { data, isLoading, error, refetch } = useReadContract({
    address: lens as Address,
    abi: lensAbi,
    functionName: "getPools",
    args: [0n, PAGE_SIZE, (address ?? "0x0000000000000000000000000000000000000000") as Address],
    chainId,
    query: { enabled: !!lens, refetchInterval: 15_000 },
  });

  const pools = useMemo<Pool[]>(() => {
    if (!data) return [];
    return (data as readonly Pool[]).map((pool) => ({
      ...pool,
      share: pool.totalSupply > 0n ? Number(pool.userLiquidity) / Number(pool.totalSupply) : 0,
    }));
  }, [data]);

  const myPools = useMemo(() => pools.filter((p) => p.userLiquidity > 0n), [pools]);

  return { pools, myPools, isLoading, error, refetch };
}

/** Finds the pool for a token pair, in either order. */
export function usePool(tokenA: Address | undefined, tokenB: Address | undefined) {
  const { pools, isLoading, refetch } = usePools();

  const pool = useMemo(() => {
    if (!tokenA || !tokenB) return undefined;
    const a = tokenA.toLowerCase();
    const b = tokenB.toLowerCase();
    return pools.find((p) => {
      const t0 = p.token0.toLowerCase();
      const t1 = p.token1.toLowerCase();
      return (t0 === a && t1 === b) || (t0 === b && t1 === a);
    });
  }, [pools, tokenA, tokenB]);

  return { pool, isLoading, refetch };
}
