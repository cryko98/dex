import { useEffect, useMemo, useState } from "react";
import { maxUint256, type Address } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";

import { erc20Abi, routerAbi } from "../abi";
import { useDex } from "../hooks/useDex";
import type { Pool } from "../hooks/usePools";
import { useSettings } from "../hooks/useSettings";
import { useTransaction } from "../hooks/useTransaction";
import { applySlippage, deadlineFromNow, formatAmount } from "../lib/format";
import { SpinnerIcon } from "./Icons";
import { Modal } from "./Modal";
import { TokenAvatar } from "./TokenAvatar";

const PRESETS = [25, 50, 75, 100];

interface Props {
  pool: Pool | undefined;
  onClose: () => void;
  onDone?: () => void;
}

/** Burns a share of an LP position and returns the underlying tokens. */
export function RemoveLiquidity({ pool, onClose, onDone }: Props) {
  const { address } = useAccount();
  const { router, weth, native, chainId } = useDex();
  const settings = useSettings();
  const { writeContractAsync } = useWriteContract();
  const { run, isBusy } = useTransaction();
  const [percent, setPercent] = useState(50);

  useEffect(() => setPercent(50), [pool?.pair]);

  const liquidity = useMemo(() => {
    if (!pool) return 0n;
    return percent >= 100 ? pool.userLiquidity : (pool.userLiquidity * BigInt(percent)) / 100n;
  }, [percent, pool]);

  // What the burn returns, pro rata on the current reserves.
  const expected = useMemo(() => {
    if (!pool || pool.totalSupply === 0n) return { amount0: 0n, amount1: 0n };
    return {
      amount0: (liquidity * pool.reserve0) / pool.totalSupply,
      amount1: (liquidity * pool.reserve1) / pool.totalSupply,
    };
  }, [liquidity, pool]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: pool?.pair,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && router ? [address, router as Address] : undefined,
    chainId,
    query: { enabled: !!pool && !!address && !!router },
  });

  const needsApproval = (allowance ?? 0n) < liquidity;

  // A native-currency side lets us return ETH instead of WETH.
  const wethSide = useMemo<0 | 1 | undefined>(() => {
    if (!pool || !weth) return undefined;
    if (pool.token0.toLowerCase() === weth.toLowerCase()) return 0;
    if (pool.token1.toLowerCase() === weth.toLowerCase()) return 1;
    return undefined;
  }, [pool, weth]);

  const approveLp = () =>
    run({
      pendingTitle: "Approving LP tokens",
      successTitle: "LP tokens approved",
      send: () =>
        writeContractAsync({
          address: pool!.pair,
          abi: erc20Abi,
          functionName: "approve",
          args: [router as Address, settings.unlimitedApproval ? maxUint256 : liquidity],
        }),
      onSuccess: () => void refetchAllowance(),
    });

  const submit = () => {
    if (!pool || !router || !address || liquidity === 0n) return;

    const deadline = deadlineFromNow(settings.deadline);
    const min0 = applySlippage(expected.amount0, settings.slippage, "min");
    const min1 = applySlippage(expected.amount1, settings.slippage, "min");
    const base = { address: router as Address, abi: routerAbi } as const;

    void run({
      pendingTitle: `Removing ${pool.symbol0}/${pool.symbol1} liquidity`,
      successTitle: `Removed ${percent}% of your ${pool.symbol0}/${pool.symbol1} position`,
      send: () => {
        if (wethSide !== undefined) {
          // The other token stays an ERC-20; the WETH side comes back as native currency.
          const token = wethSide === 0 ? pool.token1 : pool.token0;
          const minToken = wethSide === 0 ? min1 : min0;
          const minEth = wethSide === 0 ? min0 : min1;
          return writeContractAsync({
            ...base,
            functionName: "removeLiquidityETH",
            args: [token, liquidity, minToken, minEth, address, deadline],
          });
        }
        return writeContractAsync({
          ...base,
          functionName: "removeLiquidity",
          args: [pool.token0, pool.token1, liquidity, min0, min1, address, deadline],
        });
      },
      onSuccess: () => {
        onDone?.();
        onClose();
      },
    });
  };

  const symbolFor = (side: 0 | 1) => {
    const symbol = side === 0 ? pool?.symbol0 : pool?.symbol1;
    // Show the native symbol on whichever side unwraps.
    return wethSide === side ? native.symbol : symbol;
  };

  return (
    <Modal open={!!pool} title="Remove liquidity" onClose={onClose}>
      {pool && (
        <>
          <div className="card" style={{ padding: 16, boxShadow: "none", background: "var(--surface)" }}>
            <div style={{ textAlign: "center" }}>
              <div className="percent-display">{percent}%</div>
              <input
                className="slider"
                type="range"
                min={1}
                max={100}
                value={percent}
                onChange={(event) => setPercent(Number(event.target.value))}
              />
              <div className="chips">
                {PRESETS.map((value) => (
                  <button
                    key={value}
                    className={percent === value ? "chip chip--active" : "chip"}
                    onClick={() => setPercent(value)}
                  >
                    {value === 100 ? "Max" : `${value}%`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="details" style={{ marginTop: 14 }}>
            <div className="details__body" style={{ borderTop: "none", paddingTop: 12 }}>
              <div className="details__row">
                <span>You receive</span>
                <span className="row" style={{ gap: 6 }}>
                  <TokenAvatar symbol={symbolFor(0) ?? ""} size="sm" />
                  {formatAmount(expected.amount0, pool.decimals0, 6)} {symbolFor(0)}
                </span>
              </div>
              <div className="details__row">
                <span />
                <span className="row" style={{ gap: 6 }}>
                  <TokenAvatar symbol={symbolFor(1) ?? ""} size="sm" />
                  {formatAmount(expected.amount1, pool.decimals1, 6)} {symbolFor(1)}
                </span>
              </div>
              <div className="details__row">
                <span>LP tokens burned</span>
                <span>{formatAmount(liquidity, 18, 6)}</span>
              </div>
            </div>
          </div>

          <div className="actions">
            {needsApproval && liquidity > 0n && (
              <button className="btn btn--primary btn--block" disabled={isBusy} onClick={() => void approveLp()}>
                Approve LP tokens
              </button>
            )}
            <button
              className="btn btn--primary btn--block"
              disabled={needsApproval || liquidity === 0n || isBusy}
              onClick={submit}
            >
              {isBusy && <SpinnerIcon size={18} />}
              Remove liquidity
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
