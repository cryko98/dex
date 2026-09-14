import { defineChain } from "viem";
import type { Chain } from "viem";

/**
 * Robinhood Chain's public parameters are supplied through .env rather than hard-coded,
 * so this app can point at mainnet, a testnet, or a local fork without a code change.
 * See .env.example for the variables.
 */
const env = import.meta.env;

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const localhost = defineChain({
  id: 31337,
  name: "Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

const configuredChainId = Number(env.VITE_CHAIN_ID);
const configuredRpc = env.VITE_RPC_URL;

export const hasRobinhoodConfig = Number.isFinite(configuredChainId) && configuredChainId > 0 && !!configuredRpc;

export const robinhoodChain: Chain | undefined = hasRobinhoodConfig
  ? defineChain({
      id: configuredChainId,
      name: env.VITE_CHAIN_NAME || "Robinhood Chain",
      nativeCurrency: {
        name: env.VITE_NATIVE_NAME || "Ether",
        symbol: env.VITE_NATIVE_SYMBOL || "ETH",
        decimals: num(env.VITE_NATIVE_DECIMALS, 18),
      },
      rpcUrls: { default: { http: [configuredRpc as string] } },
      blockExplorers: env.VITE_EXPLORER_URL
        ? {
            default: {
              name: env.VITE_EXPLORER_NAME || "Explorer",
              url: env.VITE_EXPLORER_URL as string,
            },
          }
        : undefined,
    })
  : undefined;

const enableLocalhost = env.VITE_ENABLE_LOCALHOST !== "false";

/** Every chain the app will talk to, in menu order. Always at least one entry. */
export const supportedChains = (
  [robinhoodChain, enableLocalhost ? localhost : undefined].filter(Boolean) as Chain[]
).length
  ? ([robinhoodChain, enableLocalhost ? localhost : undefined].filter(Boolean) as [Chain, ...Chain[]])
  : ([localhost] as [Chain, ...Chain[]]);

export const defaultChain = supportedChains[0];

export function explorerTxUrl(chain: Chain | undefined, hash: string): string | undefined {
  const base = chain?.blockExplorers?.default.url;
  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : undefined;
}

export function explorerAddressUrl(chain: Chain | undefined, address: string): string | undefined {
  const base = chain?.blockExplorers?.default.url;
  return base ? `${base.replace(/\/$/, "")}/address/${address}` : undefined;
}
