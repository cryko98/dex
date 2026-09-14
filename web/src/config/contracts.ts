import type { Address } from "viem";
import deployments from "./deployments.json";

export interface DeployedToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

export interface Deployment {
  chainId: number;
  name: string;
  deployedAt: string;
  deployer: Address;
  contracts: {
    factory: Address;
    router: Address;
    lens: Address;
    weth: Address;
  };
  pairCodeHash: string;
  tokens: DeployedToken[];
}

const map = deployments as unknown as Record<string, Deployment>;

/** Addresses written by `contracts/scripts/deploy.js`, or undefined if not deployed there yet. */
export function getDeployment(chainId: number | undefined): Deployment | undefined {
  if (chainId === undefined) return undefined;
  return map[String(chainId)];
}

export function hasDeployment(chainId: number | undefined): boolean {
  return getDeployment(chainId) !== undefined;
}

export const deployedChainIds = Object.keys(map).map(Number);
