import { tokenColor } from "../config/tokens";

interface Props {
  symbol: string;
  size?: "sm" | "md" | "lg";
}

/** Deterministic monogram avatar, so tokens stay recognisable without a logo CDN. */
export function TokenAvatar({ symbol, size = "md" }: Props) {
  const label = symbol.replace(/^W/, "").slice(0, 3).toUpperCase();
  const className = size === "md" ? "token-avatar" : `token-avatar token-avatar--${size}`;

  return (
    <span className={className} style={{ background: tokenColor(symbol) }} title={symbol}>
      {label}
    </span>
  );
}

export function PairAvatars({ symbol0, symbol1 }: { symbol0: string; symbol1: string }) {
  return (
    <span className="avatar-stack">
      <TokenAvatar symbol={symbol0} size="sm" />
      <TokenAvatar symbol={symbol1} size="sm" />
    </span>
  );
}
