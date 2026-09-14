import { useQuery } from "@tanstack/react-query";
import { formatUnits, parseAbiItem, type Address, type GetLogsReturnType, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";

import { useDex } from "./useDex";

export const INTERVALS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
} as const;

export type IntervalKey = keyof typeof INTERVALS;

export interface Candle {
  /** Unix seconds, bucket start. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base-token volume traded in the bucket. */
  volume: number;
}

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);

/** How far back to scan. Split into chunks because many RPCs cap getLogs ranges. */
const LOOKBACK_BLOCKS = 200_000n;
const CHUNK_BLOCKS = 10_000n;
const MAX_CHUNKS = 20;

type SwapLog = GetLogsReturnType<typeof swapEvent>[number];

interface Params {
  pair: Address | undefined;
  decimals0: number;
  decimals1: number;
  /** When true, price is token0 per token1 instead of token1 per token0. */
  invert: boolean;
  interval: IntervalKey;
}

/**
 * Builds OHLC candles from the pool's own Swap events. This is the real traded
 * price on this DEX, so it works for any pair, including tokens no price feed lists.
 */
export function usePoolCandles({ pair, decimals0, decimals1, invert, interval }: Params) {
  const client = usePublicClient();
  const { chainId } = useDex();

  return useQuery({
    queryKey: ["candles", chainId, pair, interval, invert, decimals0, decimals1],
    enabled: !!pair && !!client,
    refetchInterval: 30_000,
    staleTime: 15_000,
    queryFn: async (): Promise<Candle[]> => {
      if (!pair || !client) return [];

      const latest = await client.getBlockNumber();
      const from = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n;
      const logs = await fetchSwapLogs(client, pair, from, latest);
      if (logs.length === 0) return [];

      const secondsPerBlock = await estimateBlockTime(client, latest);
      const latestBlock = await client.getBlock({ blockNumber: latest });
      const latestTime = Number(latestBlock.timestamp);

      const seconds = INTERVALS[interval];
      const buckets = new Map<number, Candle>();

      for (const log of logs) {
        const { amount0In, amount1In, amount0Out, amount1Out } = log.args;
        if (
          amount0In === undefined ||
          amount1In === undefined ||
          amount0Out === undefined ||
          amount1Out === undefined
        ) {
          continue;
        }

        // One side is always the input and the other the output.
        const zeroIn = amount0In > 0n;
        const in0 = zeroIn ? amount0In : amount0Out;
        const in1 = zeroIn ? amount1Out : amount1In;
        if (in0 === 0n || in1 === 0n) continue;

        const value0 = Number(formatUnits(in0, decimals0));
        const value1 = Number(formatUnits(in1, decimals1));
        if (!value0 || !value1) continue;

        const price = invert ? value0 / value1 : value1 / value0;
        if (!Number.isFinite(price) || price <= 0) continue;

        const blockDelta = Number(latest - (log.blockNumber ?? latest));
        const timestamp = latestTime - Math.round(blockDelta * secondsPerBlock);
        const bucket = Math.floor(timestamp / seconds) * seconds;
        const volume = invert ? value1 : value0;

        const existing = buckets.get(bucket);
        if (!existing) {
          buckets.set(bucket, { time: bucket, open: price, high: price, low: price, close: price, volume });
        } else {
          existing.high = Math.max(existing.high, price);
          existing.low = Math.min(existing.low, price);
          existing.close = price;
          existing.volume += volume;
        }
      }

      return [...buckets.values()].sort((a, b) => a.time - b.time);
    },
  });
}

async function fetchSwapLogs(
  client: PublicClient,
  address: Address,
  from: bigint,
  to: bigint,
): Promise<SwapLog[]> {
  // Walk backwards in chunks so a busy pool returns recent data quickly and a
  // rate-limited RPC still yields whatever it managed to serve.
  const collected: SwapLog[] = [];
  let end = to;

  for (let i = 0; i < MAX_CHUNKS && end > from; i++) {
    const start = end - CHUNK_BLOCKS > from ? end - CHUNK_BLOCKS : from;
    try {
      const logs = await client.getLogs({ address, event: swapEvent, fromBlock: start, toBlock: end });
      collected.push(...logs);
    } catch {
      // Range rejected or rate limited: stop here and chart what we have.
      break;
    }
    if (start === from) break;
    end = start - 1n;
  }

  return collected.sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)));
}

/** Average seconds per block, sampled across a recent window. */
async function estimateBlockTime(client: PublicClient, latest: bigint): Promise<number> {
  const span = latest > 5000n ? 5000n : latest;
  if (span === 0n) return 2;

  try {
    const [newer, older] = await Promise.all([
      client.getBlock({ blockNumber: latest }),
      client.getBlock({ blockNumber: latest - span }),
    ]);
    const delta = Number(newer.timestamp - older.timestamp) / Number(span);
    return delta > 0 && Number.isFinite(delta) ? delta : 2;
  } catch {
    return 2;
  }
}
