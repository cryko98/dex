import type { AbiEvent, Address, PublicClient } from "viem";

export interface ScanOptions {
  event: AbiEvent;
  /** Only these addresses, when you already know which contracts matter. */
  address?: Address[];
  /** How far back to try to reach, in blocks. */
  maxBlocks: bigint;
  /** Stop once this many logs are collected. */
  maxLogs: number;
  /** Give up after this many requests, so a slow RPC cannot hang the page. */
  maxRequests?: number;
  /** Blocks per request. Halved automatically when the node rejects the range. */
  chunkBlocks?: bigint;
  /** Requests issued at once. */
  concurrency?: number;
}

export interface ScanResult<T> {
  logs: T[];
  /** Oldest block actually covered. */
  fromBlock: bigint;
  toBlock: bigint;
  /** True when a cap stopped the scan before it reached maxBlocks. */
  truncated: boolean;
}

const DEFAULT_CHUNK = 10_000n;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_REQUESTS = 40;
const MIN_CHUNK = 500n;

/**
 * Reads event logs backwards from the chain head.
 *
 * Public RPCs cap both the block range and the number of logs per request, and the
 * caps differ between providers, so the chunk size adapts: when a request is refused
 * for being too large the chunk halves and the range is retried. The scan always
 * reports how far it actually got, so callers can label partial data honestly rather
 * than presenting it as a full window.
 */
export async function scanLogsBackwards<T>(
  client: PublicClient,
  latest: bigint,
  options: ScanOptions,
): Promise<ScanResult<T>> {
  const {
    event,
    address,
    maxBlocks,
    maxLogs,
    maxRequests = DEFAULT_MAX_REQUESTS,
    concurrency = DEFAULT_CONCURRENCY,
  } = options;

  const floor = latest > maxBlocks ? latest - maxBlocks : 0n;
  let chunk = options.chunkBlocks ?? DEFAULT_CHUNK;

  const logs: T[] = [];
  let cursor = latest;
  let requests = 0;
  let covered = latest;
  let truncated = false;

  while (cursor > floor && logs.length < maxLogs && requests < maxRequests) {
    // Build a wave of adjacent ranges and fetch them together.
    const ranges: { from: bigint; to: bigint }[] = [];
    for (let i = 0; i < concurrency && cursor > floor; i++) {
      const from = cursor - chunk > floor ? cursor - chunk : floor;
      ranges.push({ from, to: cursor });
      cursor = from - 1n;
    }

    requests += ranges.length;

    const settled = await Promise.all(
      ranges.map(async (range) => {
        try {
          const result = await client.getLogs({
            event,
            address,
            fromBlock: range.from,
            toBlock: range.to,
          });
          return { range, logs: result as T[], ok: true as const };
        } catch (error) {
          return { range, error, ok: false as const };
        }
      }),
    );

    const failed = settled.filter((entry) => !entry.ok);

    if (failed.length > 0 && chunk > MIN_CHUNK) {
      // Too much data for this node: retry the same span with smaller requests.
      const oldest = ranges[ranges.length - 1].from;
      cursor = ranges[0].to;
      chunk = chunk / 2n > MIN_CHUNK ? chunk / 2n : MIN_CHUNK;
      void oldest;
      continue;
    }

    if (failed.length === settled.length) {
      truncated = true;
      break;
    }

    for (const entry of settled) {
      if (entry.ok) {
        logs.push(...entry.logs);
        if (entry.range.from < covered) covered = entry.range.from;
      }
    }
  }

  if (logs.length >= maxLogs || requests >= maxRequests || cursor > floor) truncated = true;

  return { logs, fromBlock: covered, toBlock: latest, truncated };
}
