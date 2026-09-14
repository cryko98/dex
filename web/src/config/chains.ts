import { defineChain, type Chain } from "viem";

/**
 * Robinhood Chain is an Arbitrum Orbit L2 with ETH as its gas token. The public
 * endpoints below come from Robinhood's own docs; they are rate limited, so point
 * VITE_RPC_URL at a dedicated provider for anything beyond casual use.
 *
 * Multicall3 sits at the canonical address on both networks, which is what lets the
 * explorer read hundreds of pools per request without deploying anything.
 */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const env = import.meta.env;

/**
 * Reads go through the app's own /api/rpc proxy (see api/rpc.js) so the browser never
 * talks to the public endpoint directly; it sometimes sends a malformed CORS header.
 * An explicit VITE_RPC_URL / VITE_TESTNET_RPC_URL bypasses the proxy.
 */
function proxied(chain: "mainnet" | "testnet", fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return `${window.location.origin}/api/rpc/${chain}`;
}

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_RPC_URL || proxied("mainnet", "https://rpc.mainnet.chain.robinhood.com")] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_TESTNET_RPC_URL || proxied("testnet", "https://rpc.testnet.chain.robinhood.com")] } },
  blockExplorers: {
    default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

export const localhost = defineChain({
  id: 31337,
  name: "Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

/**
 * An extra network from .env, for a chain this build does not know about.
 * Set VITE_CHAIN_ID and VITE_CUSTOM_RPC_URL together.
 */
const customChainId = Number(env.VITE_CHAIN_ID);
const customRpc = env.VITE_CUSTOM_RPC_URL;

const customChain: Chain | undefined =
  Number.isFinite(customChainId) && customChainId > 0 && customRpc
    ? defineChain({
        id: customChainId,
        name: env.VITE_CHAIN_NAME || `Chain ${customChainId}`,
        nativeCurrency: {
          name: env.VITE_NATIVE_NAME || "Ether",
          symbol: env.VITE_NATIVE_SYMBOL || "ETH",
          decimals: num(env.VITE_NATIVE_DECIMALS, 18),
        },
        rpcUrls: { default: { http: [customRpc] } },
        blockExplorers: env.VITE_EXPLORER_URL
          ? { default: { name: env.VITE_EXPLORER_NAME || "Explorer", url: env.VITE_EXPLORER_URL } }
          : undefined,
        contracts: { multicall3: { address: (env.VITE_MULTICALL3 as `0x${string}`) || MULTICALL3 } },
      })
    : undefined;

const enableTestnet = env.VITE_ENABLE_TESTNET !== "false";
const enableLocalhost = env.VITE_ENABLE_LOCALHOST === "true";

/** Every chain the app will talk to, in menu order. */
export const supportedChains = [
  customChain,
  robinhoodMainnet,
  enableTestnet ? robinhoodTestnet : undefined,
  enableLocalhost ? localhost : undefined,
].filter(Boolean) as [Chain, ...Chain[]];

export const defaultChain = supportedChains[0];

export function explorerTxUrl(chain: Chain | undefined, hash: string): string | undefined {
  const base = chain?.blockExplorers?.default.url;
  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : undefined;
}

export function explorerAddressUrl(chain: Chain | undefined, address: string): string | undefined {
  const base = chain?.blockExplorers?.default.url;
  return base ? `${base.replace(/\/$/, "")}/address/${address}` : undefined;
}
