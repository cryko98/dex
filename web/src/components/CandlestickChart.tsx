import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";

import type { Candle } from "../lib/candles";

const UP = "#ccff00";
const DOWN = "#ff5000";

interface Props {
  candles: Candle[];
  /** Decimal places on the price axis; sub-cent tokens need more than the default. */
  precision?: number;
}

/** TradingView Lightweight Charts, themed to match the app. */
export function CandlestickChart({ candles, precision }: Props) {
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
        vertLine: { color: "#3a3a3a", labelBackgroundColor: UP },
        horzLine: { color: "#3a3a3a", labelBackgroundColor: UP },
      },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
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
    if (!candleRef.current) return;
    candleRef.current.applyOptions({
      priceFormat: {
        type: "price",
        precision: precision ?? 4,
        minMove: 10 ** -(precision ?? 4),
      },
    });
  }, [precision]);

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

/** Decimal places that make a price readable, from its magnitude. */
export function precisionFor(price: number | undefined): number {
  if (!price || !Number.isFinite(price) || price <= 0) return 4;
  if (price >= 100) return 2;
  if (price >= 1) return 4;
  return Math.min(10, Math.ceil(-Math.log10(price)) + 3);
}
