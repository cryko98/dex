import type { Address } from "viem";

/**
 * Where a swap should execute. By default the card trades through our own router;
 * a target points it at another DEX's router that the chain index discovered and
 * verified, so any pool on the chain becomes tradable from its own page.
 */
export interface SwapTarget {
  router: Address;
  weth: Address;
  /** Readable DEX name, for the confirmation copy. */
  dex: string;
  /**
   * Route through the fee-on-transfer-tolerant entry points. Memecoins often tax
   * transfers, and those variants work for taxed and untaxed tokens alike; the cost
   * is that exact-output trades are not available.
   */
  feeOnTransfer?: boolean;
  /** Symbols for addresses in the route, keyed by lower-case address. */
  symbols?: Record<string, string>;
}
