import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";

import { routerAbi } from "../abi";
import { sameToken, wrappedAddress, type Token } from "../config/tokens";
import { useApproval } from "../hooks/useApproval";
import { useDex } from "../hooks/useDex";
import { usePool } from "../hooks/usePools";
import { useSettings } from "../hooks/useSettings";
import { useTokenBalances, useTokenList } from "../hooks/useTokens";
import { useTransaction } from "../hooks/useTransaction";
import { applySlippage, deadlineFromNow, formatAmount, formatExact, formatPercent, formatRate, parseAmount } from "../lib/format";
import { GAS_RESERVE } from "../lib/weth";
import { ChevronDown, PlusIcon, SpinnerIcon } from "./Icons";
import { Modal } from "./Modal";
import { TokenAvatar } from "./TokenAvatar";
import { TokenSelect } from "./TokenSelect";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Preselected pair, when opened from an existing position. */
  initial?: { tokenA: Token; tokenB: Token };
  onDone?: () => void;
}

export function AddLiquidity({ open, onClose, initial, onDone }: Props) {
  const { address } = useAccount();
  const { router, weth, native } = useDex();
  const settings = useSettings();
  const { tokens } = useTokenList();
  const { balances, refetch: refetchBalances } = useTokenBalances(tokens);
  const { writeContractAsync } = useWriteContract();
  const { run, isBusy } = useTransaction();

  const [tokenA, setTokenA] = useState<Token | undefined>(initial?.tokenA ?? native);
  const [tokenB, setTokenB] = useState<Token | undefined>(initial?.tokenB);
  const [valueA, setValueA] = useState("");
  const [valueB, setValueB] = useState("");
  const [lastEdited, setLastEdited] = useState<"a" | "b">("a");
  const [picker, setPicker] = useState<"a" | "b" | null>(null);

  useEffect(() => {
    if (!open) return;
    setTokenA(initial?.tokenA ?? native);
    setTokenB(initial?.tokenB);
    setValueA("");
    setValueB("");
  }, [initial, native, open]);

  const addressA = tokenA && weth ? wrappedAddress(tokenA, weth) : undefined;
  const addressB = tokenB && weth ? wrappedAddress(tokenB, weth) : undefined;
  const { pool, refetch: refetchPool } = usePool(addressA, addressB);

  const isNewPool = !pool || pool.reserve0 === 0n || pool.reserve1 === 0n;

  // Reserves oriented to the user's A/B choice rather than the pool's sort order.
  const reserves = useMemo(() => {
    if (!pool || !addressA) return undefined;
    const aIsToken0 = pool.token0.toLowerCase() === addressA.toLowerCase();
    return {
      a: aIsToken0 ? pool.reserve0 : pool.reserve1,
      b: aIsToken0 ? pool.reserve1 : pool.reserve0,
    };
  }, [addressA, pool]);

  const rawA = parseAmount(valueA, tokenA?.decimals ?? 18);
  const rawB = parseAmount(valueB, tokenB?.decimals ?? 18);

  // An existing pool fixes the ratio, so the untouched field follows the typed one.
  useEffect(() => {
    if (isNewPool || !reserves || reserves.a === 0n || reserves.b === 0n) return;

    if (lastEdited === "a" && tokenB) {
      const next = rawA > 0n ? (rawA * reserves.b) / reserves.a : 0n;
      setValueB(rawA > 0n ? formatExact(next, tokenB.decimals) : "");
    } else if (lastEdited === "b" && tokenA) {
      const next = rawB > 0n ? (rawB * reserves.a) / reserves.b : 0n;
      setValueA(rawB > 0n ? formatExact(next, tokenA.decimals) : "");
    }
  }, [isNewPool, lastEdited, rawA, rawB, reserves, tokenA, tokenB]);

  const balanceA = tokenA ? balances.get(tokenA.address.toLowerCase()) : undefined;
  const balanceB = tokenB ? balances.get(tokenB.address.toLowerCase()) : undefined;

  const approvalA = useApproval(tokenA, rawA);
  const approvalB = useApproval(tokenB, rawB);

  const shareOfPool = useMemo(() => {
    if (!pool || isNewPool || !reserves) return 1;
    if (reserves.a === 0n) return 1;
    const added = Number(rawA);
    const existing = Number(reserves.a);
    if (!existing) return 1;
    return added / (existing + added);
  }, [isNewPool, pool, rawA, reserves]);

  const insufficient =
    (balanceA !== undefined && rawA > balanceA) || (balanceB !== undefined && rawB > balanceB);

  const ready = !!tokenA && !!tokenB && rawA > 0n && rawB > 0n && !insufficient && !!address && !!router;
  const needsApprovalA = !!tokenA && !approvalA.isApproved;
  const needsApprovalB = !!tokenB && !approvalB.isApproved;

  const setMax = (side: "a" | "b") => {
    const token = side === "a" ? tokenA : tokenB;
    const balance = side === "a" ? balanceA : balanceB;
    if (!token || balance === undefined) return;
    const usable = token.isNative ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance;
    setLastEdited(side);
    if (side === "a") setValueA(formatExact(usable, token.decimals));
    else setValueB(formatExact(usable, token.decimals));
  };

  const submit = () => {
    if (!ready || !tokenA || !tokenB || !router || !address || !weth) return;

    const deadline = deadlineFromNow(settings.deadline);
    const minA = applySlippage(rawA, settings.slippage, "min");
    const minB = applySlippage(rawB, settings.slippage, "min");
    const base = { address: router as Address, abi: routerAbi } as const;

    void run({
      pendingTitle: `Adding ${tokenA.symbol}/${tokenB.symbol} liquidity`,
      successTitle: `Added liquidity to ${tokenA.symbol}/${tokenB.symbol}`,
      send: () => {
        // The router has a dedicated path for native currency on either side.
        if (tokenA.isNative) {
          return writeContractAsync({
            ...base,
            functionName: "addLiquidityETH",
            args: [tokenB.address, rawB, minB, minA, address, deadline],
            value: rawA,
          });
        }
        if (tokenB.isNative) {
          return writeContractAsync({
            ...base,
            functionName: "addLiquidityETH",
            args: [tokenA.address, rawA, minA, minB, address, deadline],
            value: rawB,
          });
        }
        return writeContractAsync({
          ...base,
          functionName: "addLiquidity",
          args: [tokenA.address, tokenB.address, rawA, rawB, minA, minB, address, deadline],
        });
      },
      onSuccess: () => {
        setValueA("");
        setValueB("");
        void refetchBalances();
        void refetchPool();
        onDone?.();
        onClose();
      },
    });
  };

  const pick = (token: Token) => {
    if (picker === "a") {
      setTokenA(token);
      if (sameToken(token, tokenB)) setTokenB(tokenA);
    } else if (picker === "b") {
      setTokenB(token);
      if (sameToken(token, tokenA)) setTokenA(tokenB);
    }
  };

  return (
    <>
      <Modal open={open} title="Add liquidity" onClose={onClose}>
        {isNewPool && tokenA && tokenB && (
          <div className="banner banner--info" style={{ marginTop: 0, marginBottom: 14 }}>
            You are the first liquidity provider for this pair. The ratio you set becomes the starting price.
          </div>
        )}

        <div className="stack" style={{ gap: 8 }}>
          <LiquidityField
            token={tokenA}
            value={valueA}
            balance={balanceA}
            onChange={(value) => {
              setLastEdited("a");
              setValueA(value);
            }}
            onPick={() => setPicker("a")}
            onMax={() => setMax("a")}
          />

          <div style={{ display: "grid", placeItems: "center", color: "var(--text-faint)" }}>
            <PlusIcon size={18} />
          </div>

          <LiquidityField
            token={tokenB}
            value={valueB}
            balance={balanceB}
            onChange={(value) => {
              setLastEdited("b");
              setValueB(value);
            }}
            onPick={() => setPicker("b")}
            onMax={() => setMax("b")}
          />
        </div>

        {tokenA && tokenB && rawA > 0n && rawB > 0n && (
          <div className="details" style={{ marginTop: 14 }}>
            <div className="details__body" style={{ borderTop: "none", paddingTop: 12 }}>
              <div className="details__row">
                <span>{tokenA.symbol} per {tokenB.symbol}</span>
                <span>{formatRate(Number(valueA) / Number(valueB))}</span>
              </div>
              <div className="details__row">
                <span>{tokenB.symbol} per {tokenA.symbol}</span>
                <span>{formatRate(Number(valueB) / Number(valueA))}</span>
              </div>
              <div className="details__row">
                <span>Share of pool</span>
                <span>{formatPercent(shareOfPool * 100)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="actions">
          {needsApprovalA && rawA > 0n && (
            <button
              className="btn btn--primary btn--block"
              disabled={isBusy}
              onClick={() =>
                void run({
                  pendingTitle: `Approving ${tokenA?.symbol}`,
                  successTitle: `${tokenA?.symbol} approved`,
                  send: () => approvalA.approve(settings.unlimitedApproval),
                  onSuccess: () => void approvalA.refetchAllowance(),
                })
              }
            >
              Approve {tokenA?.symbol}
            </button>
          )}

          {needsApprovalB && rawB > 0n && (
            <button
              className="btn btn--primary btn--block"
              disabled={isBusy}
              onClick={() =>
                void run({
                  pendingTitle: `Approving ${tokenB?.symbol}`,
                  successTitle: `${tokenB?.symbol} approved`,
                  send: () => approvalB.approve(settings.unlimitedApproval),
                  onSuccess: () => void approvalB.refetchAllowance(),
                })
              }
            >
              Approve {tokenB?.symbol}
            </button>
          )}

          <button
            className="btn btn--primary btn--block"
            disabled={!ready || needsApprovalA || needsApprovalB || isBusy}
            onClick={submit}
          >
            {isBusy && <SpinnerIcon size={18} />}
            {!tokenA || !tokenB
              ? "Select both tokens"
              : insufficient
                ? "Not enough balance"
                : rawA === 0n || rawB === 0n
                  ? "Enter amounts"
                  : isNewPool
                    ? "Create pool and add liquidity"
                    : "Add liquidity"}
          </button>
        </div>
      </Modal>

      <TokenSelect
        open={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={pick}
        disabledToken={picker === "a" ? tokenB : tokenA}
      />
    </>
  );
}

interface FieldProps {
  token: Token | undefined;
  value: string;
  balance: bigint | undefined;
  onChange: (value: string) => void;
  onPick: () => void;
  onMax: () => void;
}

function LiquidityField({ token, value, balance, onChange, onPick, onMax }: FieldProps) {
  return (
    <div className="field">
      <div className="field__body">
        <input
          className="field__input"
          style={{ fontSize: 24 }}
          inputMode="decimal"
          placeholder="0"
          value={value}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value.replace(/,/g, ".");
            if (next === "" || /^\d*\.?\d*$/.test(next)) onChange(next);
          }}
        />
        <button className={token ? "token-pill" : "token-pill token-pill--empty"} onClick={onPick}>
          {token ? (
            <>
              <TokenAvatar symbol={token.symbol} />
              {token.symbol}
            </>
          ) : (
            <span style={{ paddingLeft: 6 }}>Select</span>
          )}
          <ChevronDown size={15} />
        </button>
      </div>

      <div className="field__foot">
        <span />
        {token && balance !== undefined && (
          <span className="row" style={{ gap: 8 }}>
            <span>Balance {formatAmount(balance, token.decimals, 4)}</span>
            {balance > 0n && (
              <button className="max-btn" onClick={onMax}>
                MAX
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
