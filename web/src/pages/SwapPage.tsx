import { useEffect, useState } from "react";

import { PairChart } from "../components/PairChart";
import { SwapCard } from "../components/SwapCard";
import { PairAvatars } from "../components/TokenAvatar";
import { sameToken, wrappedAddress, type Token } from "../config/tokens";
import { useDex } from "../hooks/useDex";
import { usePairStatByTokens } from "../hooks/usePairStats";
import { useSettings } from "../hooks/useSettings";
import { useTokenList } from "../hooks/useTokens";
import { formatChange, formatCompactUsd, formatPriceUsd, formatRate } from "../lib/format";

/** Symbols to land on by default, in order of preference. */
const PREFERRED_QUOTE = ["USDC", "USDT", "DAI"];

interface Props {
  /** Pair handed over from the explorer, if the user arrived via "Buy"/"Sell". */
  initialPair?: { tokenIn: Token; tokenOut: Token };
  onOpenPair?: (pair: string) => void;
}

export function SwapPage({ initialPair, onOpenPair }: Props) {
  const { native, chainId, weth } = useDex();
  const { tokens } = useTokenList();
  const settings = useSettings();

  const [tokenIn, setTokenIn] = useState<Token | undefined>(initialPair?.tokenIn ?? native);
  const [tokenOut, setTokenOut] = useState<Token | undefined>(initialPair?.tokenOut);

  // Defaults, unless the explorer handed us a specific pair to trade.
  useEffect(() => {
    if (initialPair) {
      setTokenIn(initialPair.tokenIn);
      setTokenOut(initialPair.tokenOut);
      return;
    }
    setTokenIn(native);
    const quote =
      PREFERRED_QUOTE.map((symbol) => tokens.find((t) => t.symbol === symbol)).find(Boolean) ??
      tokens.find((t) => !t.isNative && !sameToken(t, native));
    setTokenOut(quote);
    // Re-run on chain change or when the list first arrives, not on every identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, initialPair, tokens.length]);

  const { stat, isRefreshing, timeframe } = usePairStatByTokens(
    tokenIn && weth ? wrappedAddress(tokenIn, weth) : undefined,
    tokenOut && weth ? wrappedAddress(tokenOut, weth) : undefined,
  );

  const headline = stat?.windows[timeframe];

  return (
    <>
      {settings.showChart && stat && (
        <>
          <div className="swap-chart-head">
            <div className="chart__pair">
              <PairAvatars symbol0={stat.sides.baseSymbol} symbol1={stat.sides.quoteSymbol} />
              <div>
                <div style={{ fontWeight: 700 }}>
                  {stat.sides.baseSymbol}/{stat.sides.quoteSymbol}
                </div>
                <div className="small muted">
                  {formatCompactUsd(stat.liquidityUsd)} liquidity · {formatCompactUsd(headline?.volumeUsd ?? 0)} {timeframe} vol
                </div>
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div className="chart__price">
                {stat.priceUsd !== undefined ? formatPriceUsd(stat.priceUsd) : formatRate(stat.price)}
              </div>
              <div
                className={
                  headline?.change === undefined ? "small muted" : headline.change >= 0 ? "small up" : "small down"
                }
              >
                {formatChange(headline?.change)} · {timeframe}
              </div>
            </div>

            {onOpenPair && (
              <button className="btn btn--sm" onClick={() => onOpenPair(stat.pool.pair)}>
                Pair details
              </button>
            )}
          </div>

          <PairChart stat={stat} loading={isRefreshing} height={280} />
        </>
      )}

      <SwapCard
        tokenIn={tokenIn}
        tokenOut={tokenOut}
        onChangeTokens={(nextIn, nextOut) => {
          setTokenIn(nextIn);
          setTokenOut(nextOut);
        }}
      />
    </>
  );
}
