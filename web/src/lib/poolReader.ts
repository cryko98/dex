import { zeroAddress, type Address, type PublicClient } from "viem";

/**
 * Reads Uniswap-V2-style pools straight from the chain with Multicall3.
 *
 * Nothing here depends on our own contracts being deployed, which is what lets the
 * explorer index a chain we have never touched: any pool exposing the standard V2
 * surface can be described.
 */

const pairAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }],
  },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const tokenAbi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export interface TokenMeta {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: bigint;
}

export interface RawPool {
  pair: Address;
  /** The factory that deployed the pool, read from the pair itself. */
  factory?: Address;
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  name0: string;
  name1: string;
  decimals0: number;
  decimals1: number;
  reserve0: bigint;
  reserve1: bigint;
  lpTotalSupply: bigint;
  userLiquidity: bigint;
  supply0: bigint;
  supply1: bigint;
}

/** Multicall batch size. Large enough to be efficient, small enough not to be refused. */
const BATCH = 60;

/**
 * Describes the given pair addresses. Addresses that are not V2 pools are dropped
 * rather than failing the batch, because discovery inevitably turns up false positives.
 */
export async function describePairs(
  client: PublicClient,
  pairs: Address[],
  user?: Address,
): Promise<{ pools: RawPool[]; tokens: Map<string, TokenMeta> }> {
  if (pairs.length === 0) return { pools: [], tokens: new Map() };

  const account = user ?? zeroAddress;

  // --- pass 1: pool shape --------------------------------------------------
  const core = new Map<
    string,
    {
      factory?: Address;
      token0: Address;
      token1: Address;
      reserve0: bigint;
      reserve1: bigint;
      lpTotalSupply: bigint;
      userLiquidity: bigint;
    }
  >();

  for (let i = 0; i < pairs.length; i += BATCH) {
    const slice = pairs.slice(i, i + BATCH);
    const contracts = slice.flatMap((pair) => [
      { address: pair, abi: pairAbi, functionName: "factory" } as const,
      { address: pair, abi: pairAbi, functionName: "token0" } as const,
      { address: pair, abi: pairAbi, functionName: "token1" } as const,
      { address: pair, abi: pairAbi, functionName: "getReserves" } as const,
      { address: pair, abi: pairAbi, functionName: "totalSupply" } as const,
      { address: pair, abi: pairAbi, functionName: "balanceOf", args: [account] } as const,
    ]);

    let results;
    try {
      results = await client.multicall({ contracts, allowFailure: true });
    } catch {
      continue; // lose this batch, not the page
    }

    slice.forEach((pair, index) => {
      const base = index * 6;
      const factory = results[base];
      const token0 = results[base + 1];
      const token1 = results[base + 2];
      const reserves = results[base + 3];
      const supply = results[base + 4];
      const balance = results[base + 5];

      if (token0.status !== "success" || token1.status !== "success" || reserves.status !== "success") return;

      const [reserve0, reserve1] = reserves.result as readonly [bigint, bigint, number];
      core.set(pair.toLowerCase(), {
        factory: factory.status === "success" ? (factory.result as Address) : undefined,
        token0: token0.result as Address,
        token1: token1.result as Address,
        reserve0,
        reserve1,
        lpTotalSupply: supply.status === "success" ? (supply.result as bigint) : 0n,
        userLiquidity: balance.status === "success" ? (balance.result as bigint) : 0n,
      });
    });
  }

  // --- pass 2: token metadata, once per token ------------------------------
  const tokenAddresses = [
    ...new Set([...core.values()].flatMap((p) => [p.token0.toLowerCase(), p.token1.toLowerCase()])),
  ] as Address[];

  const tokens = await describeTokens(client, tokenAddresses);

  // --- assemble ------------------------------------------------------------
  const pools: RawPool[] = [];
  for (const [pair, info] of core) {
    const meta0 = tokens.get(info.token0.toLowerCase());
    const meta1 = tokens.get(info.token1.toLowerCase());
    if (!meta0 || !meta1) continue;

    pools.push({
      pair: pair as Address,
      factory: info.factory,
      token0: info.token0,
      token1: info.token1,
      symbol0: meta0.symbol,
      symbol1: meta1.symbol,
      name0: meta0.name,
      name1: meta1.name,
      decimals0: meta0.decimals,
      decimals1: meta1.decimals,
      reserve0: info.reserve0,
      reserve1: info.reserve1,
      lpTotalSupply: info.lpTotalSupply,
      userLiquidity: info.userLiquidity,
      supply0: meta0.totalSupply,
      supply1: meta1.totalSupply,
    });
  }

  return { pools, tokens };
}

/** Symbol, name, decimals and supply for a list of tokens. */
export async function describeTokens(
  client: PublicClient,
  addresses: Address[],
): Promise<Map<string, TokenMeta>> {
  const tokens = new Map<string, TokenMeta>();

  for (let i = 0; i < addresses.length; i += BATCH) {
    const slice = addresses.slice(i, i + BATCH);
    const contracts = slice.flatMap((token) => [
      { address: token, abi: tokenAbi, functionName: "symbol" } as const,
      { address: token, abi: tokenAbi, functionName: "name" } as const,
      { address: token, abi: tokenAbi, functionName: "decimals" } as const,
      { address: token, abi: tokenAbi, functionName: "totalSupply" } as const,
    ]);

    let results;
    try {
      results = await client.multicall({ contracts, allowFailure: true });
    } catch {
      continue;
    }

    slice.forEach((token, index) => {
      const base = index * 4;
      const symbol = results[base];
      const name = results[base + 1];
      const decimals = results[base + 2];
      const supply = results[base + 3];

      // decimals() is the one field we cannot sensibly guess, so require it.
      if (decimals.status !== "success") return;

      tokens.set(token.toLowerCase(), {
        address: token,
        symbol: symbol.status === "success" ? String(symbol.result) : shortSymbol(token),
        name: name.status === "success" ? String(name.result) : "Unknown token",
        decimals: Number(decimals.result),
        totalSupply: supply.status === "success" ? (supply.result as bigint) : 0n,
      });
    });
  }

  return tokens;
}

function shortSymbol(address: Address): string {
  return `${address.slice(2, 6).toUpperCase()}`;
}
