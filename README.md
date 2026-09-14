# Rho — memecoin screener & DEX for Robinhood Chain

A DexScreener-style explorer for **Robinhood Chain** (Arbitrum Orbit L2, chain id
4663), plus a swap interface and our own AMM. It lists every coin trading on the
chain — including memecoins launched on other DEXes — without an indexer or an API
key: it reads the chain directly over JSON-RPC and Multicall3.

> Not affiliated with Robinhood Markets, Inc.

---

## What it does

**Explore** — every pool with recent trades on the chain, from every DEX. Price, age,
transactions (buys/sells), volume, makers, 5m/15m/1h/6h change, liquidity, FDV. Pools
are discovered from on-chain `Swap` events and attributed to their DEX by asking each
pair for its `factory()`. Nothing is configured per DEX.

**Memecoins** — the community-token screener:

- **Total memecoin volume**, active coins, transactions, distinct makers and
  liquidity across the whole chain, for the selected timeframe.
- **Trending themes bar** — Dogs, Cats, Chinese coins, Frogs, AI, Robinhood-themed,
  Politics… ranked by how many live coins sit in each, with volume and a
  volume-weighted change. Themes come from keyword matching on names and symbols
  (`web/src/lib/categories.ts`); click one to filter.
- **Heat** — a 0-100 rank blend of volume, transactions, makers and buy pressure.
- **Risk flags** — `rugged` when liquidity is essentially gone while the coin still
  trades (anything bought cannot be sold back), `thin` under $5K liquidity. Rugged
  coins are penalised in heat so they cannot lead the board; a **Live** filter hides
  them.

**Token page** — one coin, all its pools: TradingView chart (Lightweight Charts, built
from the pool's own fills; USD or quote-denominated), performance grid, buy-pressure
bar, pools list, live transaction feed, and a **swap panel**.

**Swap on any DEX, without deploying anything** — the index reads the `sender` of each
`Swap` event (the contract that called the pool), takes each factory's busiest caller,
and verifies it is that factory's router by calling `factory()` and `WETH()` on it. A
verified router is a standard UniswapV2Router02, so the app trades through it with
the fee-on-transfer-tolerant entry points (taxed memecoins work). On Robinhood Chain
mainnet the dominant memecoin DEX's router is found this way; pools whose DEX has no
verifiable router are marked *view only*.

**Rho AMM** — our own factory/router/pair contracts (Solidity 0.8, 32 tests). When
deployed on a chain, the Swap and Pool tabs trade through it and its pools show as
"Rho" in the explorer. Not required for the explorer or for swapping on other DEXes.

---

## How the data works (and its limits)

The browser talks to the chain through `/api/rpc/<chain>`, a same-origin proxy
(`api/rpc/[chain].js`, a Vercel edge function; mirrored by Vite's dev proxy). The
public Robinhood endpoint sometimes returns a duplicated CORS header that browsers
reject, and the proxy also lets a provider key stay server-side.

Per refresh the index:

1. scans `Swap` logs backwards from the head for the selected timeframe (15m / 1h /
   6h), with adaptive chunk sizes — public RPCs cap a request at 10,000 logs;
2. describes the busiest pools (up to 250) with Multicall3: `token0/1`, reserves,
   `factory()`, token symbol/name/decimals/supply;
3. verifies routers from the swap senders;
4. reads `PairCreated` over a bounded range for pool ages;
5. prices everything in USD from stablecoin pools outward (USDG on Robinhood Chain),
   preferring the deepest pool for each token.

Block timestamps are interpolated from the measured block time (~0.1 s on Robinhood
Chain) rather than fetched per block. Because the RPC caps log history, a window
longer than what the scan reached is shown as `—`, never as an understated number,
and the page says how far back it actually got. A full 24h view on a chain this busy
needs an indexer; this app is deliberately indexer-free.

---

## Run it

```bash
git clone https://github.com/cryko98/dex.git
cd dex
npm run setup      # installs contracts + web, compiles, exports ABIs
npm run dev        # http://localhost:5173 — reads Robinhood Chain mainnet
```

No wallet or key is needed to browse. To trade, connect an injected wallet
(MetaMask, Rabby…) on Robinhood Chain.

### Vercel

`vercel.json` builds `web/` and serves `web/dist`; the edge function under `api/`
deploys with it. Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `RPC_MAINNET_URL`, `RPC_TESTNET_URL` | Upstream for the proxy (server-side). Point at Alchemy/dRPC/QuickNode for higher limits; defaults to the public endpoints. |
| `VITE_RPC_URL`, `VITE_TESTNET_RPC_URL` | Bypass the proxy and read a given endpoint directly from the browser. |
| `VITE_ENABLE_TESTNET` | `false` hides the testnet from the network picker. |
| `VITE_ENABLE_LOCALHOST` | `true` adds the local Hardhat chain. |
| `VITE_DEX_NAMES` | JSON map of factory address → display name, e.g. `{"0x8bce…":"Launchpad"}`. Unnamed factories show as `DEX 8BCE`. |
| `VITE_CHAIN_ID` + `VITE_CUSTOM_RPC_URL` (+ `VITE_CHAIN_NAME`, `VITE_EXPLORER_URL`, `VITE_MULTICALL3`) | Add an extra EVM network. |

### Network details

| | Mainnet | Testnet |
| --- | --- | --- |
| Chain id | 4663 | 46630 |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | robinhoodchain.blockscout.com | explorer.testnet.chain.robinhood.com |
| Multicall3 | `0xcA11…CA11` (canonical) | same |

Source: Robinhood's docs (`docs.robinhood.com/chain/connecting`).

---

## Deploying the Rho AMM (optional)

```bash
cd contracts
cp .env.example .env          # PRIVATE_KEY, ROBINHOOD_RPC_URL, ROBINHOOD_CHAIN_ID=4663
npm run build
npm run deploy:robinhood      # writes deployments/4663.json + web/src/config/deployments.json
```

Then commit `web/src/config/deployments.json` and redeploy the site. Local
development against a Hardhat node: `npm run chain`, `npm run deploy`,
`npm run seed:external` (a second "DEX" with community tokens, to exercise
discovery), `npm run simulate`.

### Contracts

| Contract | Role |
| --- | --- |
| `RhoFactory` | One canonical pool per pair via CREATE2. |
| `RhoPair` | Constant-product pool, 0.30% fee, TWAP oracle, `createdAt`, optional protocol fee. |
| `RhoRouter` | UniswapV2Router02-compatible, including fee-on-transfer variants. |
| `RhoLens` | Read-only aggregation; describes pools from any V2-style factory. |

```bash
cd contracts && npm test     # 32 passing
```

Not audited. Do not put funds you care about into it without a professional review.

---

## Layout

```
api/rpc/[chain].js      same-origin JSON-RPC proxy (Vercel edge)
contracts/              Hardhat project: core/, periphery/, libraries/, mocks/, scripts/, test/
web/src/
  hooks/useChainIndex   swap scan → pools → routers → ages (the indexer-free index)
  hooks/usePairStats    per-pool price, liquidity, FDV, windowed stats, trades
  hooks/useTokenStats   per-token roll-up, themes, heat, risk, memecoin totals
  lib/logScanner        adaptive backwards getLogs
  lib/poolReader        Multicall3 pool/token description
  lib/pricing           USD pricing graph, quote/base resolution, memecoin heuristic
  lib/categories        theme keywords and ranking
  pages/                Explore, Memes, Token, Pair, Swap, Pool, Tokens
```
