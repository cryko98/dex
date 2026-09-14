import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useAccount, useWriteContract } from "wagmi";

import { routerAbi } from "../abi";
import { hasDeployment } from "../config/contracts";
import { sameToken, type Token } from "../config/tokens";
import { useApproval } from "../hooks/useApproval";
import { useDex } from "../hooks/useDex";
import {
  BLOCKING_PRICE_IMPACT,
  HIGH_PRICE_IMPACT,
  HIGH_SLIPPAGE,
  useSettings,
} from "../hooks/useSettings";
import { useSwapQuote, type TradeType } from "../hooks/useSwapQuote";
import { useTokenBalances, useTokenList } from "../hooks/useTokens";
import { useTransaction } from "../hooks/useTransaction";
import {
  applySlippage,
  deadlineFromNow,
  exchangeRate,
  formatAmount,
  formatExact,
  formatPercent,
  formatRate,
  parseAmount,
} from "../lib/format";
import { GAS_RESERVE, wethAbi } from "../lib/weth";
import type { SwapTarget } from "../lib/swapTarget";
import { AlertIcon, ArrowDown, ChevronDown, SpinnerIcon } from "./Icons";
import { TokenAvatar } from "./TokenAvatar";
import { TokenSelect } from "./TokenSelect";

type Side = "in" | "out";

interface Props {
  tokenIn: Token | undefined;
  tokenOut: Token | undefined;
  onChangeTokens: (tokenIn: Token | undefined, tokenOut: Token | undefined) => void;
  /** Trade through another DEX's verified router instead of our own. */
  target?: SwapTarget;
}

export function SwapCard({ tokenIn, tokenOut, onChangeTokens, target }: Props) {
  const { address, isConnected } = useAccount();
  const dex = useDex();
  const { chainId, chain, native } = dex;
  const router = target?.router ?? dex.router;
  const weth = target?.weth ?? dex.weth;
  // A discovered router is verified against its factory, so it counts as supported.
  const isSupported = target ? true : dex.isSupported;
  const fot = !!target?.feeOnTransfer;
  const settings = useSettings();
  const { tokens } = useTokenList();
  const { balances, refetch: refetchBalances } = useTokenBalances(tokens);
  const { writeContractAsync } = useWriteContract();
  const { run, isBusy } = useTransaction();

  const [picker, setPicker] = useState<Side | null>(null);
  const [tradeType, setTradeType] = useState<TradeType>("exactIn");
  const [inputValue, setInputValue] = useState("");
  const [outputValue, setOutputValue] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  // ETH <-> WETH is a wrap, not a trade: there is no pool for it.
  const wrapMode = useMemo<"wrap" | "unwrap" | undefined>(() => {
    if (!weth || !tokenIn || !tokenOut) return undefined;
    const inIsNative = !!tokenIn.isNative;
    const outIsNative = !!tokenOut.isNative;
    const inIsWeth = !inIsNative && tokenIn.address.toLowerCase() === weth.toLowerCase();
    const outIsWeth = !outIsNative && tokenOut.address.toLowerCase() === weth.toLowerCase();
    if (inIsNative && outIsWeth) return "wrap";
    if (inIsWeth && outIsNative) return "unwrap";
    return undefined;
  }, [tokenIn, tokenOut, weth]);

  const typedSide = tradeType === "exactIn" ? "in" : "out";
  const typedToken = typedSide === "in" ? tokenIn : tokenOut;
  const typedRaw = parseAmount(typedSide === "in" ? inputValue : outputValue, typedToken?.decimals ?? 18);

  const { quote, isLoading: quoteLoading, noRoute } = useSwapQuote(
    tokenIn,
    tokenOut,
    wrapMode ? 0n : typedRaw,
    tradeType,
    target,
  );

  // Wrapping is 1:1, so mirror the typed amount straight across.
  const amountIn = wrapMode
    ? typedRaw
    : tradeType === "exactIn"
      ? typedRaw
      : (quote?.otherAmount ?? 0n);
  const amountOut = wrapMode
    ? typedRaw
    : tradeType === "exactIn"
      ? (quote?.otherAmount ?? 0n)
      : typedRaw;

  // Mirror the quoted side into its input box.
  useEffect(() => {
    if (wrapMode) {
      if (tradeType === "exactIn") setOutputValue(inputValue);
      else setInputValue(outputValue);
      return;
    }
    if (!quote) {
      if (tradeType === "exactIn") setOutputValue("");
      else setInputValue("");
      return;
    }
    if (tradeType === "exactIn" && tokenOut) {
      setOutputValue(formatExact(quote.otherAmount, tokenOut.decimals));
    } else if (tradeType === "exactOut" && tokenIn) {
      setInputValue(formatExact(quote.otherAmount, tokenIn.decimals));
    }
  }, [inputValue, outputValue, quote, tokenIn, tokenOut, tradeType, wrapMode]);

  const balanceIn = tokenIn ? balances.get(tokenIn.address.toLowerCase()) : undefined;
  const balanceOut = tokenOut ? balances.get(tokenOut.address.toLowerCase()) : undefined;

  const approvalAmount = wrapMode
    ? tokenIn?.isNative
      ? 0n
      : amountIn
    : amountIn;
  const { isApproved, approve, refetchAllowance } = useApproval(
    // Wrapping WETH -> ETH calls the token itself, so no router allowance is needed.
    wrapMode === "unwrap" ? undefined : tokenIn,
    approvalAmount,
    router as Address | undefined,
  );

  const insufficientBalance = balanceIn !== undefined && amountIn > balanceIn;
  const rate = exchangeRate(amountIn, tokenIn?.decimals ?? 18, amountOut, tokenOut?.decimals ?? 18);

  const minReceived = useMemo(
    () => (amountOut > 0n ? applySlippage(amountOut, settings.slippage, "min") : 0n),
    [amountOut, settings.slippage],
  );
  const maxSpent = useMemo(
    () => (amountIn > 0n ? applySlippage(amountIn, settings.slippage, "max") : 0n),
    [amountIn, settings.slippage],
  );

  const priceImpact = quote?.priceImpact ?? 0;
  const impactBlocked = priceImpact >= BLOCKING_PRICE_IMPACT;

  const setSide = (side: Side, token: Token) => {
    // Picking the token already on the other side flips the pair instead of duplicating it.
    if (side === "in") {
      onChangeTokens(token, sameToken(token, tokenOut) ? tokenIn : tokenOut);
    } else {
      onChangeTokens(sameToken(token, tokenIn) ? tokenOut : tokenIn, token);
    }
  };

  const flip = () => {
    onChangeTokens(tokenOut, tokenIn);
    setTradeType(tradeType === "exactIn" ? "exactOut" : "exactIn");
    const nextInput = outputValue;
    const nextOutput = inputValue;
    setInputValue(nextInput);
    setOutputValue(nextOutput);
  };

  const setMax = () => {
    if (!tokenIn || balanceIn === undefined) return;
    // Leave enough native currency behind to pay for the transaction itself.
    const usable = tokenIn.isNative ? (balanceIn > GAS_RESERVE ? balanceIn - GAS_RESERVE : 0n) : balanceIn;
    setTradeType("exactIn");
    setInputValue(formatExact(usable, tokenIn.decimals));
  };

  const onAfterTrade = useCallback(() => {
    setInputValue("");
    setOutputValue("");
    void refetchBalances();
    void refetchAllowance();
  }, [refetchAllowance, refetchBalances]);

  const doApprove = () =>
    run({
      pendingTitle: `Approving ${tokenIn?.symbol}`,
      successTitle: `${tokenIn?.symbol} approved`,
      send: () => approve(settings.unlimitedApproval),
      onSuccess: () => void refetchAllowance(),
    });

  const doWrap = () =>
    run({
      pendingTitle: wrapMode === "wrap" ? `Wrapping ${native.symbol}` : `Unwrapping ${tokenIn?.symbol}`,
      successTitle: wrapMode === "wrap" ? `Wrapped ${native.symbol}` : `Unwrapped to ${native.symbol}`,
      send: () =>
        wrapMode === "wrap"
          ? writeContractAsync({
              address: weth as Address,
              abi: wethAbi,
              functionName: "deposit",
              value: amountIn,
            })
          : writeContractAsync({
              address: weth as Address,
              abi: wethAbi,
              functionName: "withdraw",
              args: [amountIn],
            }),
      onSuccess: onAfterTrade,
    });

  const doSwap = () => {
    if (!quote || !router || !address || !tokenIn || !tokenOut) return Promise.resolve(false);

    const path = quote.path;
    const deadline = deadlineFromNow(settings.deadline);
    const nativeIn = !!tokenIn.isNative;
    const nativeOut = !!tokenOut.isNative;

    return run({
      pendingTitle: `Swapping ${tokenIn.symbol} for ${tokenOut.symbol}${target ? ` on ${target.dex}` : ""}`,
      successTitle: `Swapped ${formatAmount(amountIn, tokenIn.decimals, 4)} ${tokenIn.symbol} for ${formatAmount(
        amountOut,
        tokenOut.decimals,
        4,
      )} ${tokenOut.symbol}`,
      send: () => {
        const base = { address: router as Address, abi: routerAbi } as const;

        if (tradeType === "exactIn" && fot) {
          // Taxed memecoins revert on the exact-amount entry points; these tolerate them.
          if (nativeIn) {
            return writeContractAsync({
              ...base,
              functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
              args: [minReceived, path, address, deadline],
              value: amountIn,
            });
          }
          if (nativeOut) {
            return writeContractAsync({
              ...base,
              functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
              args: [amountIn, minReceived, path, address, deadline],
            });
          }
          return writeContractAsync({
            ...base,
            functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
            args: [amountIn, minReceived, path, address, deadline],
          });
        }

        if (tradeType === "exactIn") {
          if (nativeIn) {
            return writeContractAsync({
              ...base,
              functionName: "swapExactETHForTokens",
              args: [minReceived, path, address, deadline],
              value: amountIn,
            });
          }
          if (nativeOut) {
            return writeContractAsync({
              ...base,
              functionName: "swapExactTokensForETH",
              args: [amountIn, minReceived, path, address, deadline],
            });
          }
          return writeContractAsync({
            ...base,
            functionName: "swapExactTokensForTokens",
            args: [amountIn, minReceived, path, address, deadline],
          });
        }

        if (nativeIn) {
          return writeContractAsync({
            ...base,
            functionName: "swapETHForExactTokens",
            args: [amountOut, path, address, deadline],
            value: maxSpent,
          });
        }
        if (nativeOut) {
          return writeContractAsync({
            ...base,
            functionName: "swapTokensForExactETH",
            args: [amountOut, maxSpent, path, address, deadline],
          });
        }
        return writeContractAsync({
          ...base,
          functionName: "swapTokensForExactTokens",
          args: [amountOut, maxSpent, path, address, deadline],
        });
      },
      onSuccess: onAfterTrade,
    });
  };

  const action = resolveAction({
    isConnected,
    isSupported,
    hasContracts: !!target || hasDeployment(chainId),
    fotExactOut: fot && tradeType === "exactOut",
    chainName: chain?.name,
    tokenIn,
    tokenOut,
    amountIn,
    insufficientBalance,
    isApproved,
    wrapMode,
    quoteLoading,
    noRoute,
    impactBlocked,
    isBusy,
  });

  const symbolFor = (address: Address) =>
    target?.symbols?.[address.toLowerCase()] ??
    tokens.find((t) => t.address.toLowerCase() === address.toLowerCase())?.symbol ??
    (weth && address.toLowerCase() === weth.toLowerCase() ? "WETH" : `${address.slice(0, 6)}…`);

  return (
    <div className="card">
      <div className="swap">
        <AmountField
          label="You pay"
          token={tokenIn}
          value={inputValue}
          balance={balanceIn}
          onChange={(value) => {
            setTradeType("exactIn");
            setInputValue(value);
          }}
          onPick={() => setPicker("in")}
          onMax={setMax}
          showMax
        />

        <div className="swap__flip">
          <button onClick={flip} aria-label="Switch tokens" disabled={!tokenIn && !tokenOut}>
            <ArrowDown size={16} />
          </button>
        </div>

        <AmountField
          label="You receive"
          token={tokenOut}
          value={outputValue}
          balance={balanceOut}
          loading={quoteLoading && tradeType === "exactOut"}
          readOnly={fot}
          onChange={(value) => {
            setTradeType("exactOut");
            setOutputValue(value);
          }}
          onPick={() => setPicker("out")}
        />
      </div>

      {wrapMode && amountIn > 0n && (
        <div className="banner banner--info">
          {wrapMode === "wrap"
            ? `${native.symbol} and W${native.symbol} always trade 1:1. No fee, no price impact.`
            : `Unwrapping returns ${native.symbol} 1:1. No fee, no price impact.`}
        </div>
      )}

      {!wrapMode && quote && amountIn > 0n && (
        <div className="details">
          <button className="details__summary" onClick={() => setDetailsOpen((value) => !value)}>
            <span>
              1 {tokenIn?.symbol} = {formatRate(rate)} {tokenOut?.symbol}
            </span>
            <span className="row" style={{ gap: 6 }}>
              {priceImpact >= HIGH_PRICE_IMPACT && (
                <span className="badge badge--warn">{formatPercent(priceImpact)} impact</span>
              )}
              <ChevronDown size={15} style={{ transform: detailsOpen ? "rotate(180deg)" : undefined }} />
            </span>
          </button>

          {detailsOpen && (
            <div className="details__body">
              <div className="details__row">
                <span>Price impact</span>
                <span className={priceImpact >= HIGH_PRICE_IMPACT ? "down" : undefined}>
                  {formatPercent(priceImpact)}
                </span>
              </div>
              <div className="details__row">
                <span>Liquidity provider fee</span>
                <span>{formatPercent(quote.lpFeePercent)}</span>
              </div>
              <div className="details__row">
                <span>{tradeType === "exactIn" ? "Minimum received" : "Maximum sold"}</span>
                <span>
                  {tradeType === "exactIn"
                    ? `${formatAmount(minReceived, tokenOut?.decimals ?? 18, 6)} ${tokenOut?.symbol}`
                    : `${formatAmount(maxSpent, tokenIn?.decimals ?? 18, 6)} ${tokenIn?.symbol}`}
                </span>
              </div>
              <div className="details__row">
                <span>Slippage tolerance</span>
                <span className={settings.slippage >= HIGH_SLIPPAGE ? "down" : undefined}>{settings.slippage}%</span>
              </div>
              <div className="details__row">
                <span>Route</span>
                <span className="route">
                  {quote.path.map((step, index) => (
                    <span key={`${step}-${index}`} className="row" style={{ gap: 5 }}>
                      {index > 0 && <span className="route__arrow">→</span>}
                      <TokenAvatar symbol={symbolFor(step)} size="sm" />
                      <span className="small">{symbolFor(step)}</span>
                    </span>
                  ))}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {priceImpact >= HIGH_PRICE_IMPACT && !impactBlocked && (
        <div className="banner banner--warn">
          <AlertIcon size={16} />
          <span>
            This trade moves the price by {formatPercent(priceImpact)}. The pool may be too thin for this size.
          </span>
        </div>
      )}

      {impactBlocked && (
        <div className="banner banner--danger">
          <AlertIcon size={16} />
          <span>
            Price impact is above {BLOCKING_PRICE_IMPACT}%. Trade a smaller amount, or add liquidity to this pool first.
          </span>
        </div>
      )}

      {noRoute && !wrapMode && amountIn > 0n && (
        <div className="banner banner--info">
          No route between {tokenIn?.symbol} and {tokenOut?.symbol}. Create the pool on the Pool tab to trade it.
        </div>
      )}

      <div className="actions">
        {action.kind === "approve" && (
          <button className="btn btn--primary btn--block" disabled={isBusy} onClick={() => void doApprove()}>
            {isBusy ? <SpinnerIcon size={18} /> : null}
            Approve {tokenIn?.symbol}
          </button>
        )}

        <button
          className="btn btn--primary btn--block"
          disabled={action.kind !== "go" || isBusy}
          onClick={() => void (wrapMode ? doWrap() : doSwap())}
        >
          {isBusy && action.kind === "go" ? <SpinnerIcon size={18} /> : null}
          {action.nextLabel ?? action.label}
        </button>
      </div>

      <TokenSelect
        open={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={(token) => picker && setSide(picker, token)}
        disabledToken={picker === "in" ? tokenOut : tokenIn}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  token: Token | undefined;
  value: string;
  balance: bigint | undefined;
  loading?: boolean;
  showMax?: boolean;
  /** Display only: the other field drives the trade. */
  readOnly?: boolean;
  onChange: (value: string) => void;
  onPick: () => void;
  onMax?: () => void;
}

function AmountField({
  label,
  token,
  value,
  balance,
  loading,
  showMax,
  readOnly,
  onChange,
  onPick,
  onMax,
}: FieldProps) {
  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {loading && <SpinnerIcon size={14} />}
      </div>

      <div className="field__body">
        <input
          className="field__input"
          inputMode="decimal"
          placeholder="0"
          value={value}
          spellCheck={false}
          readOnly={readOnly}
          onChange={(event) => {
            if (readOnly) return;
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
            <span style={{ paddingLeft: 6 }}>Select token</span>
          )}
          <ChevronDown size={15} />
        </button>
      </div>

      <div className="field__foot">
        <span />
        {token && balance !== undefined && (
          <span className="row" style={{ gap: 8 }}>
            <span>
              Balance {formatAmount(balance, token.decimals, 4)}
            </span>
            {showMax && balance > 0n && onMax && (
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

// ---------------------------------------------------------------------------

type Action = {
  kind: "go" | "disabled" | "approve";
  label: string;
  /** What the primary button reads while an approval is still outstanding. */
  nextLabel?: string;
};

/** Single place that decides what the primary button says and whether it is live. */
function resolveAction(state: {
  isConnected: boolean;
  isSupported: boolean;
  hasContracts: boolean;
  chainName: string | undefined;
  tokenIn: Token | undefined;
  tokenOut: Token | undefined;
  amountIn: bigint;
  insufficientBalance: boolean;
  isApproved: boolean;
  wrapMode: "wrap" | "unwrap" | undefined;
  quoteLoading: boolean;
  noRoute: boolean;
  impactBlocked: boolean;
  isBusy: boolean;
  fotExactOut: boolean;
}): Action {
  if (!state.isConnected) return { kind: "disabled", label: "Connect your wallet to trade" };
  if (!state.isSupported) {
    return {
      kind: "disabled",
      label: state.hasContracts ? "Switch to a supported network" : `Rho is not deployed on ${state.chainName ?? "this network"}`,
    };
  }
  if (!state.tokenIn || !state.tokenOut) return { kind: "disabled", label: "Select a token" };
  if (state.amountIn === 0n) return { kind: "disabled", label: "Enter an amount" };
  if (state.insufficientBalance) return { kind: "disabled", label: `Not enough ${state.tokenIn.symbol}` };

  if (state.wrapMode) {
    const verb = state.wrapMode === "wrap" ? "Wrap" : "Unwrap";
    if (!state.isApproved) {
      return { kind: "approve", label: `Approve ${state.tokenIn.symbol}`, nextLabel: verb };
    }
    return { kind: "go", label: verb };
  }

  if (state.fotExactOut) return { kind: "disabled", label: "Enter the amount you pay" };
  if (state.quoteLoading) return { kind: "disabled", label: "Finding the best route…" };
  if (state.noRoute) return { kind: "disabled", label: "No route available" };
  if (state.impactBlocked) return { kind: "disabled", label: "Price impact too high" };
  if (!state.isApproved) {
    return { kind: "approve", label: `Approve ${state.tokenIn.symbol}`, nextLabel: "Swap" };
  }

  return { kind: "go", label: "Swap" };
}
