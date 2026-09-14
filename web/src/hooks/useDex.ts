import { useMemo } from "react";
import { useAccount, useChainId, useConfig } from "wagmi";
import type { Chain } from "viem";

import { getDeployment } from "../config/contracts";
import { nativeToken } from "../config/tokens";

/**
 * Everything address-related that the rest of the app needs, resolved from the
 * chain the wallet is currently on.
 */
export function useDex() {
  const { chains } = useConfig();
  const chainId = useChainId();
  const { isConnected, chainId: walletChainId } = useAccount();

  // Before connecting, quote against the app's default chain.
  const activeChainId = isConnected && walletChainId ? walletChainId : chainId;

  return useMemo(() => {
    const chain: Chain | undefined = chains.find((c) => c.id === activeChainId);
    const deployment = getDeployment(activeChainId);
    const native = nativeToken(
      chain?.nativeCurrency.symbol ?? "ETH",
      chain?.nativeCurrency.name ?? "Ether",
      chain?.nativeCurrency.decimals ?? 18,
    );

    return {
      chain,
      chainId: activeChainId,
      /** True when the wallet sits on a chain this app has contracts for. */
      isSupported: !!chain && !!deployment,
      /** True when the wallet is on a chain the app does not know at all. */
      isUnknownChain: isConnected && !chains.some((c) => c.id === walletChainId),
      deployment,
      router: deployment?.contracts.router,
      factory: deployment?.contracts.factory,
      lens: deployment?.contracts.lens,
      weth: deployment?.contracts.weth,
      native,
    };
  }, [activeChainId, chains, isConnected, walletChainId]);
}

export type DexContext = ReturnType<typeof useDex>;
