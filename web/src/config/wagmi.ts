import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Transport } from "viem";

import { supportedChains } from "./chains";

/**
 * Injected-only on purpose: no WalletConnect project id is required, so the app runs
 * as soon as it is served. MetaMask, Rabby, Brave and friends all surface here.
 */
// JSON-RPC batching matters here: the explorer resolves timestamps for hundreds of
// blocks, and unbatched that is hundreds of round trips.
const transports = Object.fromEntries(
  supportedChains.map((chain) => [
    chain.id,
    http(chain.rpcUrls.default.http[0], { batch: { wait: 16 } }),
  ]),
) as Record<number, Transport>;

export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors: [injected({ shimDisconnect: true })],
  transports,
  ssr: false,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
