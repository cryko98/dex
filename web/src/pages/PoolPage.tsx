import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { explorerAddressUrl } from "../config/chains";
import { useDex } from "../hooks/useDex";
import { usePools, type Pool } from "../hooks/usePools";
import { formatAmount, formatPercent, formatRate, shortenAddress } from "../lib/format";
import { AddLiquidity } from "../components/AddLiquidity";
import { RemoveLiquidity } from "../components/RemoveLiquidity";
import { DropIcon, ExternalIcon, PlusIcon, SpinnerIcon } from "../components/Icons";
import { PairAvatars } from "../components/TokenAvatar";

export function PoolPage() {
  const { isConnected } = useAccount();
  const { chain, isSupported } = useDex();
  const { pools, myPools, isLoading, refetch } = usePools();
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Pool | undefined>();

  const sorted = useMemo(
    // Deepest pools first, using reserve0 as a stand-in for size.
    () => [...pools].sort((a, b) => (b.reserve0 > a.reserve0 ? 1 : b.reserve0 < a.reserve0 ? -1 : 0)),
    [pools],
  );

  return (
    <>
      <div className="page-head row row--between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>Pool</h1>
          <p>Provide liquidity and earn 0.30% of every trade routed through your pool.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setAddOpen(true)} disabled={!isSupported}>
          <PlusIcon size={16} />
          New position
        </button>
      </div>

      {!isSupported && (
        <div className="banner banner--info" style={{ marginBottom: 16 }}>
          {isConnected
            ? `Rho is not deployed on ${chain?.name ?? "this network"}. Switch networks to see pools.`
            : "Connect your wallet to see your positions."}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <span className="card__title">Your positions</span>
          {myPools.length > 0 && <span className="badge badge--lime">{myPools.length} active</span>}
        </div>

        {isLoading ? (
          <div className="empty">
            <SpinnerIcon size={20} />
          </div>
        ) : myPools.length === 0 ? (
          <div className="empty">
            <DropIcon size={24} />
            <div style={{ marginTop: 10 }}>
              {isConnected ? "You have no liquidity positions yet." : "Connect your wallet to see your positions."}
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th className="num">Your share</th>
                  <th className="num">Pooled</th>
                  <th className="num">LP tokens</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {myPools.map((pool) => {
                  const pooled0 = pool.totalSupply > 0n ? (pool.userLiquidity * pool.reserve0) / pool.totalSupply : 0n;
                  const pooled1 = pool.totalSupply > 0n ? (pool.userLiquidity * pool.reserve1) / pool.totalSupply : 0n;

                  return (
                    <tr key={pool.pair}>
                      <td>
                        <span className="pair-cell">
                          <PairAvatars symbol0={pool.symbol0} symbol1={pool.symbol1} />
                          {pool.symbol0}/{pool.symbol1}
                        </span>
                      </td>
                      <td className="num">{formatPercent(pool.share * 100)}</td>
                      <td className="num">
                        <div>
                          {formatAmount(pooled0, pool.decimals0, 4)} {pool.symbol0}
                        </div>
                        <div className="muted small">
                          {formatAmount(pooled1, pool.decimals1, 4)} {pool.symbol1}
                        </div>
                      </td>
                      <td className="num mono">{formatAmount(pool.userLiquidity, 18, 6)}</td>
                      <td className="num">
                        <button className="btn btn--sm" onClick={() => setRemoveTarget(pool)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <span className="card__title">All pools</span>
          <span className="muted small">{pools.length} pools</span>
        </div>

        {isLoading ? (
          <div className="empty">
            <SpinnerIcon size={20} />
          </div>
        ) : pools.length === 0 ? (
          <div className="empty">No pools have been created on this network yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th className="num">Liquidity</th>
                  <th className="num">Price</th>
                  <th>Contract</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((pool) => {
                  const r0 = Number(pool.reserve0) / 10 ** pool.decimals0;
                  const r1 = Number(pool.reserve1) / 10 ** pool.decimals1;
                  const explorer = explorerAddressUrl(chain, pool.pair);

                  return (
                    <tr key={pool.pair}>
                      <td>
                        <span className="pair-cell">
                          <PairAvatars symbol0={pool.symbol0} symbol1={pool.symbol1} />
                          {pool.symbol0}/{pool.symbol1}
                          <span className="badge">0.30%</span>
                        </span>
                      </td>
                      <td className="num">
                        <div>
                          {formatAmount(pool.reserve0, pool.decimals0, 2)} {pool.symbol0}
                        </div>
                        <div className="muted small">
                          {formatAmount(pool.reserve1, pool.decimals1, 2)} {pool.symbol1}
                        </div>
                      </td>
                      <td className="num">
                        {r0 > 0 ? (
                          <>
                            <div>
                              {formatRate(r1 / r0)} {pool.symbol1}
                            </div>
                            <div className="muted small">per {pool.symbol0}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {explorer ? (
                          <a className="row small" style={{ gap: 5 }} href={explorer} target="_blank" rel="noreferrer">
                            {shortenAddress(pool.pair)}
                            <ExternalIcon size={12} />
                          </a>
                        ) : (
                          <span className="mono muted">{shortenAddress(pool.pair)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddLiquidity open={addOpen} onClose={() => setAddOpen(false)} onDone={() => void refetch()} />
      <RemoveLiquidity
        pool={removeTarget}
        onClose={() => setRemoveTarget(undefined)}
        onDone={() => void refetch()}
      />
    </>
  );
}
