import type { Address } from "viem";
import { getAddress, isAddress, zeroAddress } from "viem";

import { getDeployment } from "./contracts";

export interface Token {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  /** True for the chain's own currency, which has no contract of its own. */
  isNative?: boolean;
  /** True when the user added it by address rather than it coming from the deployment. */
  isCustom?: boolean;
}

/** Sentinel used in the UI for the chain's native currency. */
export const NATIVE_ADDRESS = zeroAddress;

export function nativeToken(symbol: string, name: string, decimals: number): Token {
  return { address: NATIVE_ADDRESS, symbol, name, decimals, isNative: true };
}

export function isNative(token: Token | undefined): boolean {
  return !!token?.isNative;
}

/** Native swaps route through WETH, so quoting always needs the wrapped address. */
export function wrappedAddress(token: Token, weth: Address): Address {
  return token.isNative ? weth : token.address;
}

export function sameToken(a: Token | undefined, b: Token | undefined): boolean {
  if (!a || !b) return false;
  return a.address.toLowerCase() === b.address.toLowerCase() && !!a.isNative === !!b.isNative;
}

/** Tokens recorded by the seed script for this chain, plus wrapped native. */
export function deployedTokens(chainId: number | undefined): Token[] {
  const deployment = getDeployment(chainId);
  if (!deployment) return [];
  return deployment.tokens.map((t) => ({
    address: getAddress(t.address),
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
  }));
}

// --- custom tokens, persisted per chain -------------------------------------

const storageKey = (chainId: number) => `rho.customTokens.${chainId}`;

export function loadCustomTokens(chainId: number | undefined): Token[] {
  if (chainId === undefined || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(chainId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Token[];
    return parsed.filter((t) => isAddress(t.address)).map((t) => ({ ...t, isCustom: true }));
  } catch {
    return [];
  }
}

export function saveCustomTokens(chainId: number, tokens: Token[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(chainId), JSON.stringify(tokens.map(({ isCustom: _, ...t }) => t)));
  } catch {
    // Storage can be unavailable (private mode); the list simply will not persist.
  }
}

/** Deterministic color for a token avatar, so the same symbol always looks the same. */
export function tokenColor(symbol: string): string {
  const palette = ["#CCFF00", "#00D4FF", "#FF7A00", "#B47CFF", "#00E08F", "#FF4D8D", "#FFD166"];
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}
