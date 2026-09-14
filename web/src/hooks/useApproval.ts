import { useCallback, useMemo } from "react";
import { maxUint256, type Address } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";

import { erc20Abi } from "../abi";
import type { Token } from "../config/tokens";
import { useDex } from "./useDex";

/**
 * Tracks whether the router may move `token` on the user's behalf, and exposes
 * the approval transaction. Native currency never needs one.
 */
export function useApproval(token: Token | undefined, amount: bigint) {
  const { address } = useAccount();
  const { router, chainId } = useDex();
  const { writeContractAsync, isPending } = useWriteContract();

  const needsContract = !!token && !token.isNative && !!router && !!address;

  const { data: allowance, refetch } = useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && router ? [address, router as Address] : undefined,
    chainId,
    query: { enabled: needsContract, refetchInterval: 15_000 },
  });

  const isApproved = useMemo(() => {
    if (!token || token.isNative) return true;
    if (amount === 0n) return true;
    return (allowance ?? 0n) >= amount;
  }, [allowance, amount, token]);

  /** Approves the exact amount by default; `unlimited` skips future prompts. */
  const approve = useCallback(
    async (unlimited = false) => {
      if (!token || token.isNative || !router) throw new Error("Nothing to approve");
      const hash = await writeContractAsync({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [router as Address, unlimited ? maxUint256 : amount],
      });
      return hash;
    },
    [amount, router, token, writeContractAsync],
  );

  return { allowance: allowance ?? 0n, isApproved, approve, isApproving: isPending, refetchAllowance: refetch };
}
