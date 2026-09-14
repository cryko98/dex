import { useEffect, useMemo, useState } from "react";

import { HeatBadge, PressureBar } from "../components/Heat";
import { ChevronDown, ExternalIcon, SpinnerIcon } from "../components/Icons";
import { PairChart } from "../components/PairChart";
import { SwapCard } from "../components/SwapCard";
import { PairAvatars, TokenAvatar } from "../components/TokenAvatar";
import { TradesTable } from "../components/TradesTable";
import { explorerAddressUrl } from "../config/chains";
import type { Token } from "../config/tokens";
import { useDex } from "../hooks/useDex";
import { WINDOWS, type WindowKey } from "../hooks/usePairStats";
import { useTokenStat } from "../hooks/useTokenStats";
import { categoryById } from "../lib/categories";
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
import type { SwapTarget } from "../lib/swapTarget";

interface Props {
  address: string;
  onBack: () => void;
  onOpenPair: (pair: string) => void;
}

/**
 * One coin, all its pools: chart, screener metrics, live trades, and a swap panel
 * that trades through whichever DEX router the index verified for its deepest pool.
 */
export function TokenPage({ address, onBack, onOpenPair }: Props) {
  const { chain, native } = useDex();
  const { token, now, timeframe, isLoading, isRefreshing } = useTokenStat(address);

  const [side, setSide] = useState<"buy" | "sell">("buy");

  // Reset to "buy" when the user navigates between coins.
  useEffect(() => setSide("buy"), [address]);

  const tokens = useMemo(() => {
    if (!token) return undefined;
    const { primary } = token;
    const { sides, pool } = primary;

    const base: Token = {
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
    };

    // Trade against native currency when the pool is quoted in wrapped native.
    const quoteIsWeth = !!pool.routerWeth && sides.quoteToken.toLowerCase() === pool.routerWeth.toLowerCase();
    const quote: Token = quoteIsWeth
      ? native
      : {
          address: sides.quoteToken,
          symbol: sides.quoteSymbol,
          name: sides.quoteIndex === 0 ? pool.name0 : pool.name1,
          decimals: sides.quoteDecimals,
        };

    const target: SwapTarget | undefined =
      pool.router && pool.routerWeth
        ? {
            router: pool.router,
            weth: pool.routerWeth,
            dex: pool.dex,
            feeOnTransfer: true,
            symbols: {
              [token.address.toLowerCase()]: token.symbol,
              [sides.quoteToken.toLowerCase()]: sides.quoteSymbol,
              [pool.routerWeth.toLowerCase()]: `W${native.symbol}`,
            },
          }
        : undefined;

    return { base, quote, target };
  }, [native, token]);

  const [tokenIn, setTokenIn] = useState<Token | undefined>();
  const [tokenOut, setTokenOut] = useState<Token | undefined>();

  useEffect(() => {
    if (!tokens) return;
    setTokenIn(side === "buy" ? tokens.quote : tokens.base);
    setTokenOut(side === "buy" ? tokens.base : tokens.quote);
  }, [side, tokens]);

  if (isLoading && !token) {
    return (
      <div className="empty">
        <SpinnerIcon size={22} />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="card">
        <div className="card__title" style={{ marginBottom: 8 }}>
          Token not found
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          <span className="mono">{shortenAddress(address, 8)}</span> has not traded in the scanned window on{" "}
          {chain?.name ?? "this network"}. Try a longer timeframe.
        </p>
        <button className="btn" onClick={onBack}>
          Back to memecoins
        </button>
      </div>
    );
  }

  const { primary } = token;
  const headline = token.windows[timeframe];
  const tokenUrl = explorerAddressUrl(chain, token.address);
  const themes = token.categories.filter((id) => id !== "other");

  return (
    <>
      <button className="btn btn--ghost btn--sm" onClick={onBack} style={{ marginBottom: 14 }}>
        <ChevronDown size={14} style={{ transform: "rotate(90deg)" }} />
        Back
      </button>

      <div className="token-head">
        <TokenAvatar symbol={token.symbol} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="token-head__title">
            {token.symbol}
            <span className="muted" style={{ fontWeight: 500, fontSize: 18 }}>
              {token.name}
            </span>
            <HeatBadge value={token.heat} />
          </div>
          <div className="tags" style={{ marginTop: 6 }}>
            <span className="badge">{token.dex}</span>
            {token.tradable ? (
              <span className="badge badge--lime">Tradable</span>
            ) : (
              <span className="badge badge--warn">View only</span>
            )}
            {token.risk === "rugged" && <span className="badge badge--warn">⚠ rugged</span>}
            {token.risk === "thin" && <span className="badge">thin liquidity</span>}
            {themes.map((id) => {
              const theme = categoryById(id);
              return (
                <span key={id} className="badge">
                  {theme.emoji} {theme.label}
                </span>
              );
            })}
            {tokenUrl ? (
              <a className="badge" href={tokenUrl} target="_blank" rel="noreferrer">
                {shortenAddress(token.address)} <ExternalIcon size={11} />
              </a>
            ) : (
              <span className="badge mono">{shortenAddress(token.address)}</span>
            )}
          </div>
        </div>

        <div className="token-head__price">
          <div className="pair-head__value">
            {token.priceUsd !== undefined ? formatPriceUsd(token.priceUsd) : formatRate(token.priceQuote)}
          </div>
          <div className={headline.change === undefined ? "muted small" : headline.change >= 0 ? "up small" : "down small"}>
            {formatChange(headline.change)} · {timeframe}
            {token.priceUsd !== undefined && (
              <span className="muted"> · {formatRate(token.priceQuote)} {token.quoteSymbol}</span>
            )}
          </div>
        </div>
      </div>

      {token.risk === "rugged" && (
        <div className="banner banner--danger" style={{ marginTop: 0, marginBottom: 16 }}>
          Liquidity has been pulled from this coin: only {formatCompactUsd(token.liquidityUsd)} remains against{" "}
          {formatCompactUsd(token.volumeUsd)} of recent volume. Anything bought now almost certainly cannot be sold.
        </div>
      )}

      <div className="summary">
        <Tile label="Liquidity" value={formatCompactUsd(token.liquidityUsd)} />
        <Tile label="FDV" value={formatCompactUsd(token.fdvUsd)} />
        <Tile label={`Volume ${timeframe}`} value={formatCompactUsd(token.volumeUsd)} />
        <Tile label={`Txns ${timeframe}`} value={formatCount(token.buys + token.sells)} />
        <Tile label={`Makers ${timeframe}`} value={formatCount(token.makers)} />
        <Tile label="Age" value={token.createdAt > 0 ? formatAge(now - token.createdAt) : "—"} />
      </div>

      <div className="token-layout">
        <div className="token-layout__main">
          <PairChart stat={primary} loading={isRefreshing} />

          <div className="card">
            <div className="card__head">
              <span className="card__title">Performance</span>
              <span className="muted small">Deepest pool: {primary.sides.baseSymbol}/{primary.sides.quoteSymbol}</span>
            </div>
            <div className="window-grid">
              {(Object.keys(WINDOWS) as WindowKey[]).map((key) => {
                const win = token.windows[key];
                const tone = !win.covered || win.change === undefined ? "muted" : win.change >= 0 ? "up" : "down";
                return (
                  <div key={key} className="window-grid__cell">
                    <div className="small muted">{key}</div>
                    <div className={`window-grid__value ${tone}`}>{win.covered ? formatChange(win.change) : "—"}</div>
                    {win.covered && (
                      <div className="small faint" style={{ marginTop: 2 }}>
                        {formatCompactUsd(win.volumeUsd)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14 }}>
              <PressureBar buys={token.buys} sells={token.sells} />
            </div>
          </div>

          {token.pairs.length > 1 && (
            <div className="card" style={{ padding: "16px 0 6px" }}>
              <div className="card__head" style={{ padding: "0 18px" }}>
                <span className="card__title">Pools</span>
                <span className="muted small">{token.pairs.length} across the chain</span>
              </div>
              <div className="table-wrap table-wrap--flush">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 18 }}>Pair</th>
                      <th>DEX</th>
                      <th className="num">Price</th>
                      <th className="num">Liquidity</th>
                      <th className="num">Volume {timeframe}</th>
                      <th className="num" style={{ paddingRight: 18 }}>
                        Txns
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {token.pairs.map((pair) => {
                      const win = pair.windows[timeframe];
                      return (
                        <tr key={pair.pool.pair} onClick={() => onOpenPair(pair.pool.pair)} style={{ cursor: "pointer" }}>
                          <td style={{ paddingLeft: 18 }}>
                            <span className="pair-cell">
                              <PairAvatars symbol0={pair.sides.baseSymbol} symbol1={pair.sides.quoteSymbol} />
                              {pair.sides.baseSymbol}/{pair.sides.quoteSymbol}
                            </span>
                          </td>
                          <td>
                            <span className="badge">{pair.pool.dex}</span>
                          </td>
                          <td className="num">{formatPriceUsd(pair.priceUsd)}</td>
                          <td className="num">{formatCompactUsd(pair.liquidityUsd)}</td>
                          <td className="num">{formatCompactUsd(win.volumeUsd)}</td>
                          <td className="num" style={{ paddingRight: 18 }}>
                            {formatCount(win.buys + win.sells)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <TradesTable stat={primary} now={now} loading={isRefreshing} />
        </div>

        <aside className="token-layout__side">
          {tokens?.target ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="seg" style={{ alignSelf: "stretch" }}>
                <button
                  className={side === "buy" ? "seg__item seg__item--active" : "seg__item"}
                  style={{ flex: 1 }}
                  onClick={() => setSide("buy")}
                >
                  Buy {token.symbol}
                </button>
                <button
                  className={side === "sell" ? "seg__item seg__item--active" : "seg__item"}
                  style={{ flex: 1 }}
                  onClick={() => setSide("sell")}
                >
                  Sell {token.symbol}
                </button>
              </div>

              <SwapCard
                tokenIn={tokenIn}
                tokenOut={tokenOut}
                target={tokens.target}
                onChangeTokens={(nextIn, nextOut) => {
                  setTokenIn(nextIn);
                  setTokenOut(nextOut);
                }}
              />

              <div className="muted small" style={{ padding: "0 4px" }}>
                Routes through {tokens.target.dex}'s router, verified on-chain against its factory. Uses the
                fee-on-transfer-safe entry points, so taxed tokens work too.
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card__title" style={{ marginBottom: 8 }}>
                Trading not available here
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                No verified router was found for {token.dex}, so this coin can be watched but not swapped from
                this page.
              </p>
            </div>
          )}

          <div className="card">
            <div className="card__head">
              <span className="card__title">Token info</span>
            </div>
            <div className="details">
              <div className="details__body" style={{ borderTop: "none", paddingTop: 12 }}>
                <Row label="Symbol" value={token.symbol} />
                <Row label="Name" value={token.name} />
                <Row label="Decimals" value={String(token.decimals)} />
                <Row
                  label="Pooled"
                  value={`${formatTokenAmount(Number(primary.sides.baseReserve) / 10 ** primary.sides.baseDecimals)} ${token.symbol}`}
                />
                <Row label="Buy pressure" value={`${Math.round(token.buyPressure * 100)}%`} />
                <Row label="Heat" value={<HeatBadge value={token.heat} compact />} />
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="details__row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

