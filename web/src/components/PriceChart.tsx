import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, createChart, type IChartApi, type ISeriesApi } from "lightweight-charts";

import { INTERVALS, usePoolCandles, type IntervalKey } from "../hooks/usePoolCandles";
import { usePool } from "../hooks/usePools";
import { wrappedAddress, type Token } from "../config/tokens";
import { useDex } from "../hooks/useDex";
import { formatRate } from "../lib/format";
import { ChartIcon, SpinnerIcon } from "./Icons";
import { TokenAvatar } from "./TokenAvatar";
import { TradingViewWidget, tradingViewSymbol } from "./TradingViewWidget";

type Source = "pool" | "tradingview";

const INTERVAL_KEYS = Object.keys(INTERVALS) as IntervalKey[];

interface Props {
  base: Token | undefined;
  quote: Token | undefined;
}

/**
 * Price history for the selected pair.
 *
 * "Pool" charts this DEX's own executed prices, rebuilt from Swap events, so it
 * works for every listed token. "Market" embeds TradingView's Advanced Chart for
 * pairs that have a recognised exchange symbol.
 */
export function PriceChart({ base, quote }: Props) {
  const { weth } = useDex();
  const [interval, setInterval] = useState<IntervalKey>("1H");
  const [source, setSource] = useState<Source>("pool");

  const baseAddress = base && weth ? wrappedAddress(base, weth) : undefined;
  const quoteAddress = quote && weth ? wrappedAddress(quote, weth) : undefined;
  const { pool } = usePool(baseAddress, quoteAddress);

  // The pool stores token0/token1 sorted by address, so flip when the user's
  // "base" happens to be token1.
  const invert = !!pool && !!baseAddress && pool.token1.toLowerCase() === baseAddress.toLowerCase();

  const { data: candles, isLoading } = usePoolCandles({
    pair: pool?.pair,
    decimals0: pool?.decimals0 ?? 18,
    decimals1: pool?.decimals1 ?? 18,
    invert,
    interval,
  });

  const tvSymbol = useMemo(() => tradingViewSymbol(base?.symbol, quote?.symbol), [base?.symbol, quote?.symbol]);

  // Spot price straight from the reserves, so the header is live even with no trades.
  const spot = useMemo(() => {
    if (!pool || pool.reserve0 === 0n || pool.reserve1 === 0n) return undefined;
    const r0 = Number(pool.reserve0) / 10 ** pool.decimals0;
    const r1 = Number(pool.reserve1) / 10 ** pool.decimals1;
    if (!r0 || !r1) return undefined;
    return invert ? r0 / r1 : r1 / r0;
  }, [invert, pool]);

  const change = useMemo(() => {
    if (!candles || candles.length < 2) return undefined;
    const first = candles[0].open;
    const last = candles[candles.length - 1].close;
    if (!first) return undefined;
    return ((last - first) / first) * 100;
  }, [candles]);

  if (!base || !quote) return null;

  return (
    <div className="card chart-card">
      <div className="chart__head">
        <div>
          <div className="chart__pair">
            <TokenAvatar symbol={base.symbol} size="sm" />
            <span style={{ fontWeight: 700 }}>
              {base.symbol}/{quote.symbol}
            </span>
            {pool && <span className="badge">0.30% fee</span>}
          </div>
          <div className="chart__price" style={{ marginTop: 6 }}>
            {spot !== undefined ? formatRate(spot) : "—"}{" "}
            <span className="chart__sub" style={{ fontWeight: 600 }}>
              {quote.symbol}
            </span>
          </div>
          <div className="chart__sub">
            {change !== undefined ? (
              <span className={change >= 0 ? "up" : "down"}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% over the shown range
              </span>
            ) : (
              "Spot price from pool reserves"
            )}
          </div>
        </div>

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
                className={source === "tradingview" ? "seg__item seg__item--active" : "seg__item"}
                onClick={() => setSource("tradingview")}
              >
                Market
              </button>
            </div>
          )}
          {source === "pool" && (
            <div className="seg">
              {INTERVAL_KEYS.map((key) => (
                <button
                  key={key}
                  className={interval === key ? "seg__item seg__item--active" : "seg__item"}
                  onClick={() => setInterval(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {source === "tradingview" && tvSymbol ? (
        <TradingViewWidget symbol={tvSymbol} interval={interval} />
      ) : (
        <div className="chart__canvas">
          <CandlestickChart candles={candles ?? []} />
          {(isLoading || !candles?.length) && (
            <div className="chart__overlay">
              {isLoading ? (
                <SpinnerIcon size={22} />
              ) : !pool ? (
                <span>
                  <ChartIcon size={22} />
                  <div style={{ marginTop: 8 }}>No pool yet for {base.symbol}/{quote.symbol}.</div>
                </span>
              ) : (
                <span>
                  <ChartIcon size={22} />
                  <div style={{ marginTop: 8 }}>No trades yet. The chart fills in as the pool is used.</div>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Thin wrapper around lightweight-charts, themed to match the app. */
function CandlestickChart({ candles }: { candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi>();
  const candleRef = useRef<ISeriesApi<"Candlestick">>();
  const volumeRef = useRef<ISeriesApi<"Histogram">>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { color: "transparent" },
        textColor: "#9a9a9a",
        fontFamily: getComputedStyle(document.body).fontFamily,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderColor: "#262626" },
      timeScale: { borderColor: "#262626", timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: "#3a3a3a", labelBackgroundColor: "#ccff00" },
        horzLine: { color: "#3a3a3a", labelBackgroundColor: "#ccff00" },
      },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#ccff00",
      downColor: "#ff5000",
      borderUpColor: "#ccff00",
      borderDownColor: "#ff5000",
      wickUpColor: "#ccff00",
      wickDownColor: "#ff5000",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "rgba(204,255,0,0.3)",
      // Volume rides along the bottom; it should not add labels to the price axis.
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = undefined;
      candleRef.current = undefined;
      volumeRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current) return;

    candleRef.current.setData(
      candles.map((c) => ({
        time: c.time as never,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    volumeRef.current.setData(
      candles.map((c) => ({
        time: c.time as never,
        value: c.volume,
        color: c.close >= c.open ? "rgba(204,255,0,0.28)" : "rgba(255,80,0,0.28)",
      })),
    );

    if (candles.length) chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
