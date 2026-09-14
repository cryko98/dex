import { useMemo, useState } from "react";
import { isAddress } from "viem";

import { formatAmount } from "../lib/format";
import { sameToken, type Token } from "../config/tokens";
import { useTokenBalances, useTokenList, useTokenLookup } from "../hooks/useTokens";
import { Modal } from "./Modal";
import { TokenAvatar } from "./TokenAvatar";
import { PlusIcon, SearchIcon, SpinnerIcon, TrashIcon } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (token: Token) => void;
  /** Token already chosen on the other side of the trade; shown but not selectable. */
  disabledToken?: Token;
}

export function TokenSelect({ open, onClose, onSelect, disabledToken }: Props) {
  const { tokens, addToken, removeToken } = useTokenList();
  const { balances } = useTokenBalances(tokens);
  const [query, setQuery] = useState("");
  const lookup = useTokenLookup();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (token) =>
        token.symbol.toLowerCase().includes(q) ||
        token.name.toLowerCase().includes(q) ||
        token.address.toLowerCase() === q,
    );
  }, [query, tokens]);

  // An address the list does not already contain can be imported.
  const importCandidate =
    isAddress(query.trim()) && filtered.length === 0 ? lookup.token : undefined;

  const handleQuery = (value: string) => {
    setQuery(value);
    lookup.reset();
    if (isAddress(value.trim())) void lookup.lookup(value);
  };

  const choose = (token: Token) => {
    onSelect(token);
    setQuery("");
    lookup.reset();
    onClose();
  };

  return (
    <Modal open={open} title="Select a token" onClose={onClose} flush>
      <div className="search">
        <SearchIcon size={16} />
        <input
          autoFocus
          value={query}
          onChange={(event) => handleQuery(event.target.value)}
          placeholder="Search name or paste address"
          spellCheck={false}
        />
      </div>

      {filtered.map((token) => {
        const balance = balances.get(token.address.toLowerCase());
        const isDisabled = sameToken(token, disabledToken);

        return (
          <div key={`${token.address}-${token.symbol}`} style={{ display: "flex", alignItems: "center" }}>
            <button className="token-row" onClick={() => choose(token)} disabled={isDisabled}>
              <TokenAvatar symbol={token.symbol} size="lg" />
              <span className="token-row__main">
                <div className="token-row__symbol">{token.symbol}</div>
                <div className="token-row__name">{isDisabled ? "Selected on the other side" : token.name}</div>
              </span>
              <span className="token-row__balance">
                {balance !== undefined ? formatAmount(balance, token.decimals, 4) : ""}
              </span>
            </button>
            {token.isCustom && (
              <button
                className="token-row__remove"
                style={{ marginRight: 14 }}
                onClick={() => removeToken(token.address)}
                aria-label={`Remove ${token.symbol}`}
                title="Remove imported token"
              >
                <TrashIcon size={15} />
              </button>
            )}
          </div>
        );
      })}

      {lookup.loading && (
        <div className="empty">
          <SpinnerIcon size={20} />
        </div>
      )}

      {importCandidate && (
        <div style={{ padding: "8px 18px 0" }}>
          <div className="banner banner--info" style={{ marginTop: 0 }}>
            Anyone can create a token with any name. Check the address before you trade it.
          </div>
          <button
            className="btn btn--primary btn--block"
            style={{ marginTop: 12 }}
            onClick={() => {
              addToken(importCandidate);
              choose(importCandidate);
            }}
          >
            <PlusIcon size={16} />
            Import {importCandidate.symbol}
          </button>
        </div>
      )}

      {!lookup.loading && !importCandidate && filtered.length === 0 && (
        <div className="empty">{lookup.error ?? "No tokens found. Paste a contract address to import one."}</div>
      )}
    </Modal>
  );
}
