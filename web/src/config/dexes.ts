import { getAddress, isAddress, type Address } from "viem";

/**
 * Names for factories the explorer discovers on-chain.
 *
 * Pair discovery is address-agnostic: it finds every Uniswap-V2-style factory by its
 * PairCreated events, so new DEXes show up without a code change. This map only puts
 * a readable name on the ones we know about.
 *
 * Extend it through VITE_DEX_NAMES, a JSON object of factory address to name:
 *   VITE_DEX_NAMES={"0xabc…":"Acme Swap"}
 */
const BUILT_IN: Record<string, string> = {};

function parseEnvNames(): Record<string, string> {
  const raw = import.meta.env.VITE_DEX_NAMES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const result: Record<string, string> = {};
    for (const [address, name] of Object.entries(parsed)) {
      if (isAddress(address) && typeof name === "string") result[address.toLowerCase()] = name;
    }
    return result;
  } catch {
    // A malformed value should not take the app down; fall back to generated names.
    return {};
  }
}

const NAMES: Record<string, string> = { ...BUILT_IN, ...parseEnvNames() };

/** Whether the explorer scans the whole chain, or only Rho's own factory. */
export const indexWholeChain = import.meta.env.VITE_INDEX_WHOLE_CHAIN !== "false";

/** A readable label for a factory: a configured name, or one derived from the address. */
export function dexName(factory: Address | undefined, rhoFactory: Address | undefined): string {
  if (!factory) return "Unknown DEX";
  const key = factory.toLowerCase();
  if (rhoFactory && key === rhoFactory.toLowerCase()) return "Rho";
  if (NAMES[key]) return NAMES[key];
  return `DEX ${getAddress(factory).slice(2, 6).toUpperCase()}`;
}
