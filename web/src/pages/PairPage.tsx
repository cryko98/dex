import { useMemo } from "react";

import { PairChart } from "../components/PairChart";
import { TradesTable } from "../components/TradesTable";
import { PairAvatars, TokenAvatar } from "../components/TokenAvatar";
import { ChevronDown, ExternalIcon, SpinnerIcon } from "../components/Icons";
import { explorerAddressUrl } from "../config/chains";
import { useDex } from "../hooks/useDex";
import { usePairStat, WINDOWS, type WindowKey } from "../hooks/usePairStats";
import { useTokenList } from "../hooks/useTokens";
import type { Token } from "../config/tokens";
import {
  formatAge,
  formatChange,
  formatCompactUsd,
  formatCount,
  formatPriceUsd,
  formatRate,
  formatTokenAmount,
  shortenAddress,
} from "../lib/format";

interface Props {
  pair: string;
  onBack: () => void;
  /** Opens the swap screen preloaded with this pair. */
  onTrade: (tokenIn: Token, tokenOut: Token) => void;
}

export function PairPage({ pair, onBack, onTrade }: Props) {
  const { chain, weth, native } = useDex();
  const { stat, isLoading, isRefreshing, timeframe } = usePairStat(pair);
  const { tokens } = useTokenList();

  const now = stat
    ? Math.max(stat.trades[0]?.timestamp ?? 0, stat.createdAt)
    : Math.floor(Date.now() / 1000);

  // Map the pair's two sides back onto tradable tokens, preferring native over WETH.
  const tradeTokens = useMemo(() => {
    if (!stat) return undefined;
    const resolve = (address: string): Token => {
      if (weth && address.toLowerCase() === weth.toLowerCase()) {
        const nativeToken = tokens.find((t) => t.isNative);
        if (nativeToken) return nativeToken;
      }
      const known = tokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
      return (
        known ?? {
          address: address as Token["address"],
          symbol: "???",
          name: "Unknown token",
          decimals: 18,
        }
      );
    };
    return {
      base: resolve(stat.sides.baseToken),
      quote: resolve(stat.sides.quoteToken),
    };
  }, [stat, tokens, weth]);

  if (isLoading && !stat) {
    return (
      <div className="empty">
        <SpinnerIcon size={22} />
      </div>
    );
  }

  if (!stat) {
    return (
      <div className="card">
        <div className="card__title" style={{ marginBottom: 8 }}>
          Pair not found
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          No pool at <span className="mono">{shortenAddress(pair, 8)}</span> on{" "}
          {chain?.name ?? "this network"}.
        </p>
        <button className="btn" onClick={onBack}>
          Back to explore
        </button>
      </div>
    );
  }

  const { sides } = stat;
  const headline = stat.windows[timeframe];
  const pairUrl = explorerAddressUrl(chain, stat.pool.pair);
  const baseUrl = explorerAddressUrl(chain, sides.baseToken);
  const isNativeQuote = !!weth && sides.quoteToken.toLowerCase() === weth.toLowerCase();

  return (
    <>
      <button className="btn btn--ghost btn--sm" onClick={onBack} style={{ marginBottom: 14 }}>
        <ChevronDown size={14} style={{ transform: "rotate(90deg)" }} />
        Back to explore
      </button>

      <div className="pair-head">
        <div className="pair-head__id">
          <PairAvatars symbol0={sides.baseSymbol} symbol1={sides.quoteSymbol} />
          <div>
            <div className="pair-head__title">
              {sides.baseSymbol}
              <span className="muted">/{isNativeQuote ? native.symbol : sides.quoteSymbol}</span>
            </div>
            <div className="small muted">
              {stat.pool.dex} · 0.30% fee
              {stat.createdAt > 0 && ` · created ${formatAge(now - stat.createdAt)} ago`}
            </div>
          </div>
        </div>

        <div className="pair-head__price">
          <div className="pair-head__value">
            {stat.priceUsd !== undefined ? formatPriceUsd(stat.priceUsd) : formatRate(stat.price)}
          </div>
          <div className={headline.change === undefined ? "muted small" : headline.change >= 0 ? "up small" : "down small"}>
            {formatChange(headline.change)} · {timeframe}
          </div>
        </div>

        {tradeTokens && (
          <div className="pair-head__actions">
            <button
              className="btn btn--primary"
              disabled={!stat.pool.isRho}
              title={stat.pool.isRho ? undefined : `This pool belongs to ${stat.pool.dex}, so it cannot be traded through Rho's router.`}
              onClick={() => onTrade(tradeTokens.quote, tradeTokens.base)}
            >
              Buy {sides.baseSymbol}
            </button>
            <button
              className="btn"
              disabled={!stat.pool.isRho}
              onClick={() => onTrade(tradeTokens.base, tradeTokens.quote)}
            >
              Sell
            </button>
          </div>
        )}
      </div>

      {!stat.pool.isRho && (
        <div className="banner banner--info" style={{ marginTop: 0, marginBottom: 16 }}>
          This pool was created by {stat.pool.dex}, another DEX on this chain. Rho indexes it for the
          explorer, but trades have to go through that DEX.
        </div>
      )}

      <div className="summary">
        <Tile label="Price" value={stat.priceUsd !== undefined ? formatPriceUsd(stat.priceUsd) : "—"} />
        <Tile label="Liquidity" value={formatCompactUsd(stat.liquidityUsd)} />
        <Tile label="FDV" value={formatCompactUsd(stat.fdvUsd)} />
        <Tile label={`Volume ${timeframe}`} value={formatCompactUsd(headline.volumeUsd)} />
      </div>

      <div className="pair-layout">
        <div className="pair-layout__main">
          <PairChart stat={stat} loading={isRefreshing} />
          <TradesTable stat={stat} now={now} loading={isRefreshing} />
        </div>

        <aside className="pair-layout__side">
          <div className="card">
            <div className="card__head">
              <span className="card__title">Performance</span>
            </div>
            <div className="window-grid">
              {(Object.keys(WINDOWS) as WindowKey[]).map((key) => {
                const win = stat.windows[key];
                const tone = win.change === undefined ? "muted" : win.change >= 0 ? "up" : "down";
                return (
                  <div key={key} className="window-grid__cell">
                    <div className="small muted">{key}</div>
                    <div className={`window-grid__value ${tone}`}>{formatChange(win.change)}</div>
                  </div>
                );
              })}
            </div>

            <div className="details" style={{ marginTop: 14 }}>
              <div className="details__body" style={{ borderTop: "none", paddingTop: 12 }}>
                <StatRow label={`Transactions (${timeframe})`} value={formatCount(headline.buys + headline.sells)} />
                <StatRow
                  label={`Buys / Sells (${timeframe})`}
                  value={
                    <>
                      <span className="up">{formatCount(headline.buys)}</span>
                      <span className="faint"> / </span>
                      <span className="down">{formatCount(headline.sells)}</span>
                    </>
                  }
                />
                <StatRow label={`Makers (${timeframe})`} value={formatCount(headline.makers)} />
                <StatRow
                  label={`Pooled ${sides.baseSymbol}`}
                  value={formatTokenAmount(Number(sides.baseReserve) / 10 ** sides.baseDecimals)}
                />
                <StatRow
                  label={`Pooled ${sides.quoteSymbol}`}
                  value={formatTokenAmount(Number(sides.quoteReserve) / 10 ** sides.quoteDecimals)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <span className="card__title">Pair info</span>
            </div>
            <div className="details">
              <div className="details__body" style={{ borderTop: "none", paddingTop: 12 }}>
                <StatRow
                  label={sides.baseSymbol}
                  value={
                    <span className="row" style={{ gap: 6 }}>
                      <TokenAvatar symbol={sides.baseSymbol} size="sm" />
                      {baseUrl ? (
                        <a className="mono" href={baseUrl} target="_blank" rel="noreferrer">
                          {shortenAddress(sides.baseToken)}
                        </a>
                      ) : (
                        <span className="mono">{shortenAddress(sides.baseToken)}</span>
                      )}
                    </span>
                  }
                />
                <StatRow
                  label="Pool"
                  value={
                    pairUrl ? (
                      <a className="row mono" style={{ gap: 5 }} href={pairUrl} target="_blank" rel="noreferrer">
                        {shortenAddress(stat.pool.pair)}
                        <ExternalIcon size={12} />
                      </a>
                    ) : (
                      <span className="mono">{shortenAddress(stat.pool.pair)}</span>
                    )
                  }
                />
                <StatRow label="DEX" value={stat.pool.dex} />
                <StatRow
                  label="Age"
                  value={stat.createdAt > 0 ? formatAge(now - stat.createdAt) : "Unknown"}
                />
                <StatRow label="LP supply" value={formatTokenAmount(Number(stat.pool.lpTotalSupply) / 1e18)} />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary__tile">
      <div className="summary__label">{label}</div>
      <div className="summary__value">{value}</div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="details__row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
