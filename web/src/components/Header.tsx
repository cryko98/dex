import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { supportedChains } from "../config/chains";
import { hasDeployment } from "../config/contracts";
import { useDex } from "../hooks/useDex";
import { formatAmount, shortenAddress } from "../lib/format";
import { ChevronDown, LogoMark, WalletIcon } from "./Icons";
import { GlobalSearch } from "./GlobalSearch";
import { SettingsMenu } from "./SettingsMenu";

export type Route = "explore" | "memes" | "swap" | "pool" | "tokens";

const TABS: { id: Route; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "memes", label: "Memecoins" },
  { id: "swap", label: "Swap" },
  { id: "pool", label: "Pool" },
  { id: "tokens", label: "Tokens" },
];

interface HeaderProps {
  route: Route;
  onNavigate: (route: Route) => void;
  onOpenPair: (pair: string) => void;
}

export function Header({ route, onNavigate, onOpenPair }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__inner">
        <a
          className="brand"
          href="#explore"
          onClick={(event) => {
            event.preventDefault();
            onNavigate("explore");
          }}
        >
          <span className="brand__mark">
            <LogoMark size={20} />
          </span>
          <span>Rho</span>
        </a>

        <nav className="nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={route === tab.id ? "nav__item nav__item--active" : "nav__item"}
              onClick={() => onNavigate(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <GlobalSearch onOpenPair={onOpenPair} />

        <div className="header__actions">
          <ChainSelector />
          <SettingsMenu />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

function ChainSelector() {
  const { chain, chainId } = useDex();
  const { isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unsupported = isConnected && !chain;
  const noContracts = !!chain && !hasDeployment(chainId);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="btn btn--sm"
        onClick={() => setOpen((value) => !value)}
        style={unsupported ? { borderColor: "var(--danger)", color: "var(--danger)" } : undefined}
        title={noContracts ? "No DEX contracts deployed on this chain" : undefined}
      >
        <span
          className="badge__dot"
          style={{ background: unsupported || noContracts ? "var(--warn)" : "var(--lime)" }}
        />
        {unsupported ? "Wrong network" : chain?.name ?? "Network"}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="popover" style={{ width: 240, padding: 8 }}>
          {supportedChains.map((option) => (
            <button
              key={option.id}
              className="token-row"
              style={{ padding: "10px 12px", borderRadius: "var(--radius-sm)" }}
              disabled={isPending}
              onClick={() => {
                switchChain({ chainId: option.id });
                setOpen(false);
              }}
            >
              <span
                className="badge__dot"
                style={{ background: hasDeployment(option.id) ? "var(--lime)" : "var(--text-faint)" }}
              />
              <span className="token-row__main">
                <div className="token-row__symbol" style={{ fontSize: 14 }}>
                  {option.name}
                </div>
                <div className="token-row__name">
                  {hasDeployment(option.id) ? `Chain ${option.id}` : "No contracts deployed"}
                </div>
              </span>
              {option.id === chainId && <span className="badge badge--lime">Active</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { chainId, native } = useDex();
  const { data: balance } = useBalance({ address, chainId, query: { enabled: !!address } });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!isConnected) {
    const connector = connectors[0];
    const hasWallet = typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum;

    if (!hasWallet) {
      return (
        <a className="btn btn--primary" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
          <WalletIcon size={16} />
          Install a wallet
        </a>
      );
    }

    return (
      <button
        className="btn btn--primary"
        disabled={isPending || !connector}
        onClick={() => connector && connect({ connector })}
        title={error?.message}
      >
        <WalletIcon size={16} />
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((value) => !value)}>
        {balance && (
          <span className="muted" style={{ fontWeight: 500 }}>
            {formatAmount(balance.value, balance.decimals, 4)} {native.symbol}
          </span>
        )}
        {shortenAddress(address ?? "")}
      </button>

      {open && (
        <div className="popover" style={{ width: 250 }}>
          <div className="row row--between" style={{ marginBottom: 12 }}>
            <span className="mono">{shortenAddress(address ?? "", 6)}</span>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                void navigator.clipboard?.writeText(address ?? "");
                setOpen(false);
              }}
              title="Copy address"
            >
              Copy
            </button>
          </div>
          <button
            className="btn btn--block"
            style={{ padding: 12, fontSize: 14 }}
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
