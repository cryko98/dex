import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address, type Hash, type Log, type PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { dexName } from "../config/dexes";
import { scanLogsBackwards } from "../lib/logScanner";
import { describePairs, type RawPool } from "../lib/poolReader";
import { useDex } from "./useDex";

export const TIMEFRAMES = {
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
} as const;

export type TimeframeKey = keyof typeof TIMEFRAMES;

export const swapEventAbi = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);

const pairCreatedAbi = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength)",
);

/** The two views a UniswapV2Router02-shaped router exposes that let us verify it. */
const routerProbeAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "WETH", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export interface SwapEvent {
  pair: Address;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hash;
  timestamp: number;
  /** The contract that called the pool, which for direct trades is the DEX's router. */
  sender: Address;
  /** Who received the output. Stands in for the trader in the makers count. */
  maker: Address;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
}

export interface DiscoveredRouter {
  address: Address;
  weth: Address;
  /** Swaps seen going through it in the scanned window. */
  swaps: number;
}

export interface IndexedPool extends RawPool {
  factory?: Address;
  dex: string;
  /** True when the pool came from our own factory. */
  isRho: boolean;
  /** A verified router for this pool's DEX, when one was found. Trades go through it. */
  router?: Address;
  routerWeth?: Address;
  /** Unix seconds the pool was created, when a PairCreated event was seen. */
  createdAt: number;
  share: number;
}

export interface ChainIndex {
  pools: IndexedPool[];
  swaps: SwapEvent[];
  /** Verified routers, keyed by lower-case factory address. */
  routers: Record<string, DiscoveredRouter>;
  /** The chain's own notion of "now". */
  headTimestamp: number;
  /** Seconds of history the scan actually covered. */
  coveredSeconds: number;
  /** True when a cap stopped the scan short of the requested timeframe. */
  truncated: boolean;
  secondsPerBlock: number;
}

/** Caps that keep a public RPC usable. */
const MAX_LOGS = 24_000;
const MAX_PAIRS = 250;
/** How far back to look for PairCreated, for pair ages. */
const CREATION_LOOKBACK_BLOCKS = 400_000n;
/** Senders per factory to test as router candidates. */
const ROUTER_CANDIDATES = 3;

/**
 * Indexes the chain directly over JSON-RPC: recent swaps, the pools they touched,
 * the factories that created them, and the routers that trade through them.
 *
 * This deliberately depends on nothing but a public RPC and Multicall3, so it lists
 * whatever is trading on the chain rather than only pools we deployed. The trade-off
 * is coverage: an RPC caps how many logs it will return, so the index covers a recent
 * window and reports how far back it actually reached.
 */
export function useChainIndex(timeframe: TimeframeKey = "1h") {
  const client = usePublicClient();
  const { address } = useAccount();
  const { chainId, factory, router: rhoRouter, weth: rhoWeth } = useDex();

  return useQuery({
    queryKey: ["chainIndex", chainId, timeframe, address ?? "anon"],
    enabled: !!client,
    refetchInterval: 45_000,
    staleTime: 20_000,
    queryFn: async (): Promise<ChainIndex> => {
      if (!client) throw new Error("No RPC client");

      const latest = await client.getBlockNumber();
      const head = await client.getBlock({ blockNumber: latest });
      const headTimestamp = Number(head.timestamp);
      const secondsPerBlock = await estimateBlockTime(client, latest, headTimestamp);

      const wantedSeconds = TIMEFRAMES[timeframe];
      const maxBlocks = BigInt(Math.ceil(wantedSeconds / Math.max(secondsPerBlock, 0.01)));

      // --- recent swaps, chain-wide -------------------------------------
      const scan = await scanLogsBackwards<Log<bigint, number, false, typeof swapEventAbi, true>>(
        client,
        latest,
        { event: swapEventAbi, maxBlocks, maxLogs: MAX_LOGS },
      );

      const coveredBlocks = Number(latest - scan.fromBlock);
      const coveredSeconds = Math.max(0, Math.round(coveredBlocks * secondsPerBlock));

      // --- the pairs those swaps touched, busiest first ------------------
      const activity = new Map<string, number>();
      for (const log of scan.logs) {
        const key = log.address.toLowerCase();
        activity.set(key, (activity.get(key) ?? 0) + 1);
      }
      const candidates = [...activity.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_PAIRS)
        .map(([pair]) => pair as Address);

      const { pools: raw } = await describePairs(client, candidates, address);
      const known = new Map(raw.map((pool) => [pool.pair.toLowerCase(), pool]));

      // --- routers: the busiest caller of each factory's pools -----------
      // A router is msg.sender to pair.swap(), so the Swap event's `sender` names it.
      // Candidates are verified by asking them which factory they serve.
      const sendersByFactory = new Map<string, Map<string, number>>();
      for (const log of scan.logs) {
        const pool = known.get(log.address.toLowerCase());
        const factoryKey = pool?.factory?.toLowerCase();
        const sender = log.args.sender;
        if (!factoryKey || !sender) continue;
        let senders = sendersByFactory.get(factoryKey);
        if (!senders) {
          senders = new Map();
          sendersByFactory.set(factoryKey, senders);
        }
        const key = sender.toLowerCase();
        senders.set(key, (senders.get(key) ?? 0) + 1);
      }

      const routers = await verifyRouters(client, sendersByFactory);

      // Our own router, when deployed here, is trusted without discovery.
      if (factory && rhoRouter && rhoWeth) {
        routers[factory.toLowerCase()] = { address: rhoRouter, weth: rhoWeth, swaps: 0 };
      }

      // --- age, from PairCreated ----------------------------------------
      const creations = await scanLogsBackwards<Log<bigint, number, false, typeof pairCreatedAbi, true>>(
        client,
        latest,
        {
          event: pairCreatedAbi,
          maxBlocks: CREATION_LOOKBACK_BLOCKS,
          maxLogs: 5000,
          maxRequests: 8,
          chunkBlocks: 50_000n,
        },
      );

      const creation = new Map<string, { factory: Address; blockNumber: bigint }>();
      for (const log of creations.logs) {
        const pair = log.args.pair;
        if (!pair) continue;
        const key = pair.toLowerCase();
        if (!known.has(key)) continue;
        creation.set(key, { factory: log.address, blockNumber: log.blockNumber ?? latest });
      }

      const estimateTime = (blockNumber: bigint) =>
        headTimestamp - Math.round(Number(latest - blockNumber) * secondsPerBlock);

      const pools: IndexedPool[] = raw.map((pool) => {
        const info = creation.get(pool.pair.toLowerCase());
        // The pair reports its own factory, which covers pools created before the
        // PairCreated scan window; that scan then only has to supply the age.
        const owner = pool.factory ?? info?.factory;
        const router = owner ? routers[owner.toLowerCase()] : undefined;
        return {
          ...pool,
          factory: owner,
          dex: dexName(owner, factory),
          isRho: !!factory && owner?.toLowerCase() === factory.toLowerCase(),
          router: router?.address,
          routerWeth: router?.weth,
          createdAt: info ? estimateTime(info.blockNumber) : 0,
          share: pool.lpTotalSupply > 0n ? Number(pool.userLiquidity) / Number(pool.lpTotalSupply) : 0,
        };
      });

      // --- swap events, restricted to pools we could describe ------------
      const swaps: SwapEvent[] = [];
      for (const log of scan.logs) {
        if (!known.has(log.address.toLowerCase())) continue;
        const { sender, amount0In, amount1In, amount0Out, amount1Out, to } = log.args;
        if (
          sender === undefined ||
          amount0In === undefined ||
          amount1In === undefined ||
          amount0Out === undefined ||
          amount1Out === undefined ||
          to === undefined
        ) {
          continue;
        }
        const blockNumber = log.blockNumber ?? latest;
        swaps.push({
          pair: log.address,
          blockNumber,
          logIndex: log.logIndex ?? 0,
          txHash: log.transactionHash ?? ("0x" as Hash),
          // Orbit chains keep a steady block time, so interpolating beats thousands
          // of getBlock calls against a rate-limited public endpoint.
          timestamp: estimateTime(blockNumber),
          sender,
          maker: to,
          amount0In,
          amount1In,
          amount0Out,
          amount1Out,
        });
      }

      swaps.sort((a, b) =>
        a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber),
      );

      return {
        pools,
        swaps,
        routers,
        headTimestamp,
        coveredSeconds,
        truncated: scan.truncated,
        secondsPerBlock,
      };
    },
  });
}

/**
 * Asks each factory's busiest callers which factory they serve. The first one that
 * answers with the right factory, and knows its WETH, is a usable router.
 */
async function verifyRouters(
  client: PublicClient,
  sendersByFactory: Map<string, Map<string, number>>,
): Promise<Record<string, DiscoveredRouter>> {
  const probes: { factory: string; sender: Address; swaps: number }[] = [];
  for (const [factory, senders] of sendersByFactory) {
    const top = [...senders.entries()].sort((a, b) => b[1] - a[1]).slice(0, ROUTER_CANDIDATES);
    for (const [sender, swaps] of top) probes.push({ factory, sender: sender as Address, swaps });
  }
  if (probes.length === 0) return {};

  let results;
  try {
    results = await client.multicall({
      contracts: probes.flatMap((probe) => [
        { address: probe.sender, abi: routerProbeAbi, functionName: "factory" } as const,
        { address: probe.sender, abi: routerProbeAbi, functionName: "WETH" } as const,
      ]),
      allowFailure: true,
    });
  } catch {
    return {};
  }

  const routers: Record<string, DiscoveredRouter> = {};
  probes.forEach((probe, index) => {
    if (routers[probe.factory]) return; // busiest verified candidate wins
    const factoryResult = results[index * 2];
    const wethResult = results[index * 2 + 1];
    if (factoryResult.status !== "success" || wethResult.status !== "success") return;
    if ((factoryResult.result as string).toLowerCase() !== probe.factory) return;
    routers[probe.factory] = { address: probe.sender, weth: wethResult.result as Address, swaps: probe.swaps };
  });

  return routers;
}

/** Average seconds per block, sampled over a recent window. */
async function estimateBlockTime(client: PublicClient, latest: bigint, headTimestamp: number): Promise<number> {
  const span = latest > 20_000n ? 20_000n : latest;
  if (span === 0n) return 2;

  try {
    const older = await client.getBlock({ blockNumber: latest - span });
    const delta = (headTimestamp - Number(older.timestamp)) / Number(span);
    return delta > 0 && Number.isFinite(delta) ? delta : 2;
  } catch {
    return 2;
  }
}
