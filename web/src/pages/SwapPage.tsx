import { useEffect, useState } from "react";

import { PriceChart } from "../components/PriceChart";
import { SwapCard } from "../components/SwapCard";
import { sameToken, type Token } from "../config/tokens";
import { useDex } from "../hooks/useDex";
import { useSettings } from "../hooks/useSettings";
import { useTokenList } from "../hooks/useTokens";

/** Symbols to land on by default, in order of preference. */
const PREFERRED_QUOTE = ["USDC", "USDT", "DAI"];

export function SwapPage() {
  const { native, chainId } = useDex();
  const { tokens } = useTokenList();
  const settings = useSettings();

  const [tokenIn, setTokenIn] = useState<Token | undefined>(native);
  const [tokenOut, setTokenOut] = useState<Token | undefined>();

  // Pick sensible defaults once the chain's token list is known.
  useEffect(() => {
    setTokenIn(native);
    const quote =
      PREFERRED_QUOTE.map((symbol) => tokens.find((t) => t.symbol === symbol)).find(Boolean) ??
      tokens.find((t) => !t.isNative && !sameToken(t, native));
    setTokenOut(quote);
    // Re-run when the chain changes, not on every list identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, tokens.length]);

  return (
    <>
      {settings.showChart && <PriceChart base={tokenIn} quote={tokenOut} />}
      <SwapCard
        tokenIn={tokenIn}
        tokenOut={tokenOut}
        onChangeTokens={(nextIn, nextOut) => {
          setTokenIn(nextIn);
          setTokenOut(nextOut);
        }}
      />
    </>
  );
}
