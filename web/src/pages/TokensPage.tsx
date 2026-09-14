import { useAccount, useWriteContract } from "wagmi";

import { testtokenAbi } from "../abi";
import { explorerAddressUrl } from "../config/chains";
import type { Token } from "../config/tokens";
import { useDex } from "../hooks/useDex";
import { useTokenBalances, useTokenList } from "../hooks/useTokens";
import { useTransaction } from "../hooks/useTransaction";
import { formatAmount, shortenAddress } from "../lib/format";
import { ExternalIcon, SpinnerIcon, TrashIcon } from "../components/Icons";
import { TokenAvatar } from "../components/TokenAvatar";

export function TokensPage() {
  const { isConnected } = useAccount();
  const { chain, isSupported } = useDex();
  const { tokens, removeToken } = useTokenList();
  const { balances, isLoading, refetch } = useTokenBalances(tokens);
  const { writeContractAsync } = useWriteContract();
  const { run, isBusy } = useTransaction();

  const isTestnet = !!chain?.testnet;

  const claim = (token: Token) =>
    run({
      pendingTitle: `Claiming ${token.symbol}`,
      successTitle: `Claimed test ${token.symbol}`,
      send: () =>
        writeContractAsync({
          address: token.address,
          abi: testtokenAbi,
          functionName: "faucet",
        }),
      onSuccess: () => void refetch(),
    });

  return (
    <>
      <div className="page-head">
        <h1>Tokens</h1>
        <p>Everything tradable on this network, plus anything you imported by address.</p>
      </div>

      {isTestnet && isSupported && (
        <div className="banner banner--info" style={{ marginTop: 0, marginBottom: 16 }}>
          This is a test network. Demo tokens have an open faucet, so you can claim some and trade without real funds.
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <span className="card__title">Token list</span>
          {isLoading && <SpinnerIcon size={16} />}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Token</th>
                <th>Address</th>
                <th className="num">Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const balance = balances.get(token.address.toLowerCase());
                const explorer = token.isNative ? undefined : explorerAddressUrl(chain, token.address);

                return (
                  <tr key={`${token.address}-${token.symbol}`}>
                    <td>
                      <span className="pair-cell">
                        <TokenAvatar symbol={token.symbol} />
                        <span>
                          <div>{token.symbol}</div>
                          <div className="muted small" style={{ fontWeight: 400 }}>
                            {token.name}
                          </div>
                        </span>
                        {token.isNative && <span className="badge">Native</span>}
                        {token.isCustom && <span className="badge badge--warn">Imported</span>}
                      </span>
                    </td>
                    <td>
                      {token.isNative ? (
                        <span className="muted small">—</span>
                      ) : explorer ? (
                        <a className="row small" style={{ gap: 5 }} href={explorer} target="_blank" rel="noreferrer">
                          {shortenAddress(token.address)}
                          <ExternalIcon size={12} />
                        </a>
                      ) : (
                        <span className="mono muted">{shortenAddress(token.address)}</span>
                      )}
                    </td>
                    <td className="num">
                      {isConnected && balance !== undefined ? formatAmount(balance, token.decimals, 6) : "—"}
                    </td>
                    <td className="num">
                      <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        {isTestnet && isConnected && !token.isNative && !token.isCustom && (
                          <button className="btn btn--sm" disabled={isBusy} onClick={() => void claim(token)}>
                            Faucet
                          </button>
                        )}
                        {token.isCustom && (
                          <button
                            className="token-row__remove"
                            onClick={() => removeToken(token.address)}
                            aria-label={`Remove ${token.symbol}`}
                            title="Remove imported token"
                          >
                            <TrashIcon size={15} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {tokens.length <= 1 && (
          <div className="empty">
            No tokens are deployed on this network yet. Import one by address from the swap screen.
          </div>
        )}
      </div>
    </>
  );
}
