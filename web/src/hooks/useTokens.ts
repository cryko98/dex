import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";
import type { Address } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContracts } from "wagmi";

import { erc20Abi } from "../abi";
import { deployedTokens, loadCustomTokens, saveCustomTokens, type Token } from "../config/tokens";
import { useDex } from "./useDex";

/** The full token list for the active chain: native, deployed and user-imported. */
export function useTokenList() {
  const { chainId, native, weth } = useDex();
  const [custom, setCustom] = useState<Token[]>([]);

  useEffect(() => {
    setCustom(loadCustomTokens(chainId));
  }, [chainId]);

  const tokens = useMemo(() => {
    const list: Token[] = [native];
    const seen = new Set<string>([native.address.toLowerCase()]);

    for (const token of [...deployedTokens(chainId), ...custom]) {
      const key = token.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(token);
    }
    return list;
  }, [chainId, custom, native]);

  const addToken = useCallback(
    (token: Token) => {
      if (chainId === undefined) return;
      const next = [...custom.filter((t) => t.address.toLowerCase() !== token.address.toLowerCase()), token];
      setCustom(next);
      saveCustomTokens(chainId, next);
    },
    [chainId, custom],
  );

  const removeToken = useCallback(
    (address: Address) => {
      if (chainId === undefined) return;
      const next = custom.filter((t) => t.address.toLowerCase() !== address.toLowerCase());
      setCustom(next);
      saveCustomTokens(chainId, next);
    },
    [chainId, custom],
  );

  return { tokens, custom, addToken, removeToken, weth };
}

/** Balances for the whole list in one multicall, refreshed on every block. */
export function useTokenBalances(tokens: Token[]) {
  const { address } = useAccount();
  const { chainId } = useDex();

  const erc20s = useMemo(() => tokens.filter((t) => !t.isNative), [tokens]);

  const nativeBalance = useBalance({
    address,
    chainId,
    query: { enabled: !!address, refetchInterval: 12_000 },
  });

  const results = useReadContracts({
    contracts: erc20s.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address as Address],
      chainId,
    })),
    query: { enabled: !!address && erc20s.length > 0, refetchInterval: 12_000 },
  });

  const balances = useMemo(() => {
    const map = new Map<string, bigint>();
    if (nativeBalance.data) {
      const native = tokens.find((t) => t.isNative);
      if (native) map.set(native.address.toLowerCase(), nativeBalance.data.value);
    }
    results.data?.forEach((result, index) => {
      if (result.status === "success") {
        map.set(erc20s[index].address.toLowerCase(), result.result as bigint);
      }
    });
    return map;
  }, [erc20s, nativeBalance.data, results.data, tokens]);

  return {
    balances,
    isLoading: nativeBalance.isLoading || results.isLoading,
    refetch: useCallback(() => {
      void nativeBalance.refetch();
      void results.refetch();
    }, [nativeBalance, results]),
  };
}

export function useTokenBalance(token: Token | undefined) {
  const { balances } = useTokenBalances(token ? [token] : []);
  return token ? balances.get(token.address.toLowerCase()) : undefined;
}

/** Looks up an arbitrary contract so the user can import a token by address. */
export function useTokenLookup() {
  const client = usePublicClient();
  const [state, setState] = useState<{ loading: boolean; token?: Token; error?: string }>({ loading: false });

  const lookup = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!isAddress(trimmed)) {
        setState({ loading: false });
        return;
      }
      if (!client) {
        setState({ loading: false, error: "No RPC connection." });
        return;
      }

      setState({ loading: true });
      const address = getAddress(trimmed);
      try {
        const [symbol, name, decimals] = await Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address, abi: erc20Abi, functionName: "name" }),
          client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
        ]);
        setState({
          loading: false,
          token: {
            address,
            symbol: String(symbol),
            name: String(name),
            decimals: Number(decimals),
            isCustom: true,
          },
        });
      } catch {
        setState({ loading: false, error: "That address does not look like an ERC-20 token." });
      }
    },
    [client],
  );

  const reset = useCallback(() => setState({ loading: false }), []);

  return { ...state, lookup, reset };
}
