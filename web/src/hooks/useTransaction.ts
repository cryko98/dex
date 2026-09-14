import { useCallback, useState } from "react";
import { BaseError, type Hash } from "viem";
import { usePublicClient } from "wagmi";

import { explorerTxUrl } from "../config/chains";
import { useDex } from "./useDex";
import { useToasts } from "./useToasts";

/** Turns a wallet or node error into something worth showing a user. */
export function describeError(error: unknown): string {
  if (error instanceof BaseError) {
    const short = error.shortMessage || error.message;
    if (/user rejected|denied transaction/i.test(short)) return "You rejected the transaction.";
    return short;
  }
  if (error instanceof Error) {
    if (/user rejected|denied transaction/i.test(error.message)) return "You rejected the transaction.";
    return error.message;
  }
  return "Something went wrong.";
}

/**
 * Runs a write, shows a pending toast, waits for the receipt and reports the outcome.
 * Returns true only when the transaction actually confirmed.
 */
export function useTransaction() {
  const client = usePublicClient();
  const { chain } = useDex();
  const { push, update } = useToasts();
  const [isBusy, setIsBusy] = useState(false);

  const run = useCallback(
    async (options: {
      pendingTitle: string;
      successTitle: string;
      description?: string;
      send: () => Promise<Hash>;
      onSuccess?: () => void;
    }): Promise<boolean> => {
      const toastId = push({
        kind: "pending",
        title: options.pendingTitle,
        description: "Confirm in your wallet…",
        sticky: true,
      });
      setIsBusy(true);

      try {
        const hash = await options.send();
        const href = explorerTxUrl(chain, hash);
        update(toastId, { description: "Waiting for confirmation…", href });

        const receipt = await client?.waitForTransactionReceipt({ hash });
        if (receipt && receipt.status === "reverted") {
          update(toastId, { kind: "error", title: "Transaction reverted", description: undefined, sticky: false });
          return false;
        }

        update(toastId, {
          kind: "success",
          title: options.successTitle,
          description: options.description,
          href,
          sticky: false,
        });
        options.onSuccess?.();
        return true;
      } catch (error) {
        update(toastId, {
          kind: "error",
          title: "Transaction failed",
          description: describeError(error),
          href: undefined,
          sticky: false,
        });
        return false;
      } finally {
        setIsBusy(false);
      }
    },
    [chain, client, push, update],
  );

  return { run, isBusy };
}
