import { useState } from "react";

import { explorerAddressUrl, explorerTxUrl } from "../config/chains";
import { useDex } from "../hooks/useDex";
import type { PairStat } from "../hooks/usePairStats";
import { formatAge, formatPriceUsd, formatRate, formatTokenAmount, shortenAddress } from "../lib/format";
import { ExternalIcon, SpinnerIcon } from "./Icons";

type SideFilter = "all" | "buy" | "sell";

const PAGE = 40;

interface Props {
  stat: PairStat | undefined;
  now: number;
  loading?: boolean;
}

/** The pair's fills, newest first, in the style of a DEX transaction feed. */
export function TradesTable({ stat, now, loading }: Props) {
  const { chain } = useDex();
  const [side, setSide] = useState<SideFilter>("all");
  const [limit, setLimit] = useState(PAGE);

  const trades = (stat?.trades ?? []).filter((t) => side === "all" || t.side === side);
  const visible = trades.slice(0, limit);
  const usdAvailable = stat?.priceUsd !== undefined;

  return (
    <div className="card" style={{ padding: "16px 0 8px" }}>
      <div className="card__head" style={{ padding: "0 18px" }}>
        <span className="card__title">Transactions</span>
        <div className="seg">
          {(["all", "buy", "sell"] as SideFilter[]).map((key) => (
            <button
              key={key}
              className={side === key ? "seg__item seg__item--active" : "seg__item"}
              onClick={() => {
                setSide(key);
                setLimit(PAGE);
              }}
            >
              {key === "all" ? "All" : key === "buy" ? "Buys" : "Sells"}
            </button>
          ))}
        </div>
      </div>

      {loading && trades.length === 0 ? (
        <div className="empty">
          <SpinnerIcon size={20} />
        </div>
      ) : trades.length === 0 ? (
        <div className="empty">No transactions in the scanned range.</div>
      ) : (
        <>
          <div className="table-wrap table-wrap--flush">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 18 }}>Age</th>
                  <th>Type</th>
                  <th className="num">Price</th>
                  <th className="num">{stat?.sides.baseSymbol}</th>
                  <th className="num">{stat?.sides.quoteSymbol}</th>
                  <th>Maker</th>
                  <th style={{ paddingRight: 18 }}>Txn</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((trade) => {
                  const txUrl = explorerTxUrl(chain, trade.txHash);
                  const makerUrl = explorerAddressUrl(chain, trade.maker);

                  return (
                    <tr key={`${trade.txHash}-${trade.timestamp}-${trade.baseAmount}`}>
                      <td className="muted" style={{ paddingLeft: 18, whiteSpace: "nowrap" }}>
                        {formatAge(now - trade.timestamp)} ago
                      </td>
                      <td className={trade.side === "buy" ? "up" : "down"} style={{ fontWeight: 600 }}>
                        {trade.side === "buy" ? "Buy" : "Sell"}
                      </td>
                      <td className={trade.side === "buy" ? "num up" : "num down"}>
                        {usdAvailable ? formatPriceUsd(trade.priceUsd) : formatRate(trade.price)}
                      </td>
                      <td className="num">{formatTokenAmount(trade.baseAmount)}</td>
                      <td className="num">{formatTokenAmount(trade.quoteAmount)}</td>
                      <td>
                        {trade.viaRouter ? (
                          <span className="muted small" title="Paid out through the DEX router; the wallet is only visible in the transaction itself.">
                            via router
                          </span>
                        ) : makerUrl ? (
                          <a className="mono" href={makerUrl} target="_blank" rel="noreferrer">
                            {shortenAddress(trade.maker)}
                          </a>
                        ) : (
                          <span className="mono muted">{shortenAddress(trade.maker)}</span>
                        )}
                      </td>
                      <td style={{ paddingRight: 18 }}>
                        {txUrl ? (
                          <a href={txUrl} target="_blank" rel="noreferrer" aria-label="View transaction">
                            <ExternalIcon size={13} />
                          </a>
                        ) : (
                          <span className="mono faint">{shortenAddress(trade.txHash, 3)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {limit < trades.length && (
            <div style={{ padding: "12px 18px 6px", textAlign: "center" }}>
              <button className="btn btn--sm" onClick={() => setLimit((value) => value + PAGE)}>
                Show more ({trades.length - limit} left)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
