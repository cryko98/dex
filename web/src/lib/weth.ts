/** Minimal wrapped-native interface, for the ETH <-> WETH shortcut in the swap card. */
export const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
] as const;

/** Native currency kept back so the user can still pay for gas after a max swap. */
export const GAS_RESERVE = 1_000_000_000_000_000n; // 0.001
