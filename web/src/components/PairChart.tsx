import { useMemo, useState } from "react";

import type { PairStat } from "../hooks/usePairStats";
import { INTERVALS, suggestInterval, tradesToCandles, type IntervalKey } from "../lib/candles";
import { CandlestickChart, precisionFor } from "./CandlestickChart";
import { ChartIcon, SpinnerIcon } from "./Icons";
import { TradingViewWidget, tradingViewSymbol } from "./TradingViewWidget";

type Source = "pool" | "market";
type Denomination = "usd" | "quote";

const INTERVAL_KEYS = Object.keys(INTERVALS) as IntervalKey[];

interface Props {
  stat: PairStat | undefined;
  loading?: boolean;
  height?: number;
}

/**
 * Price history for one pair. "Pool" charts this DEX's own fills; "Market" embeds
 * TradingView's Advanced Chart when the pair maps to a listed symbol.
 */
export function PairChart({ stat, loading, height = 380 }: Props) {
  const [source, setSource] = useState<Source>("pool");
  const [denomination, setDenomination] = useState<Denomination>("usd");
  const [interval, setInterval] = useState<IntervalKey | undefined>();

  const autoInterval = useMemo(() => suggestInterval(stat?.trades ?? []), [stat?.trades]);
  const activeInterval = interval ?? autoInterval;

  const usdAvailable = stat?.priceUsd !== undefined;
  const useUsd = denomination === "usd" && usdAvailable;

  const candles = useMemo(
    () => (stat ? tradesToCandles(stat.trades, activeInterval, useUsd) : []),
    [activeInterval, stat, useUsd],
  );

  const tvSymbol = useMemo(
    () => tradingViewSymbol(stat?.sides.baseSymbol, stat?.sides.quoteSymbol),
    [stat?.sides.baseSymbol, stat?.sides.quoteSymbol],
  );

  const precision = precisionFor(useUsd ? stat?.priceUsd : stat?.price);

  return (
    <div className="card chart-card">
      <div className="chart__controls" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="chart__controls">
          {tvSymbol && (
            <div className="seg">
              <button
                className={source === "pool" ? "seg__item seg__item--active" : "seg__item"}
                onClick={() => setSource("pool")}
              >
                Pool
              </button>
              <button
                className={source === "market" ? "seg__item seg__item--active" : "seg__item"}
                onClick={() => setSource("market")}
              >
                Market
              </button>
            </div>
          )}

          <div className="seg">
            {INTERVAL_KEYS.map((key) => (
              <button
                key={key}
                className={activeInterval === key ? "seg__item seg__item--active" : "seg__item"}
                onClick={() => setInterval(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        {source === "pool" && usdAvailable && stat && (
          <div className="seg">
            <button
              className={denomination === "usd" ? "seg__item seg__item--active" : "seg__item"}
              onClick={() => setDenomination("usd")}
            >
              USD
            </button>
            <button
              className={denomination === "quote" ? "seg__item seg__item--active" : "seg__item"}
              onClick={() => setDenomination("quote")}
            >
              {stat.sides.quoteSymbol}
            </button>
          </div>
        )}
      </div>

      {source === "market" && tvSymbol ? (
        <TradingViewWidget symbol={tvSymbol} interval={activeInterval} />
      ) : (
        <div className="chart__canvas" style={{ height }}>
          <CandlestickChart candles={candles} precision={precision} />
          {(loading || candles.length === 0) && (
            <div className="chart__overlay">
              {loading ? (
                <SpinnerIcon size={22} />
              ) : (
                <span>
                  <ChartIcon size={22} />
                  <div style={{ marginTop: 8 }}>
                    No trades yet. The chart fills in as the pool is used.
                  </div>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
