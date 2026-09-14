# Rho DEX

A complete decentralised exchange for Robinhood Chain: a constant-product AMM
(`x * y = k`, 0.30% fee) in Solidity, plus a swap and liquidity interface in the
Robinhood neon-lime look.

Two packages:

| Path        | What it is                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| `contracts` | Factory, pair, router and a read-only lens contract. Hardhat, 30 tests.      |
| `web`       | React + TypeScript + wagmi/viem frontend with a TradingView price chart.     |

> Not affiliated with Robinhood Markets, Inc. "Robinhood Chain" here just names the
> EVM network the contracts are deployed to.

---

## What it does

**Swap**

- Exact-in and exact-out trades, native currency on either side.
- Automatic routing: every direct and one-hop path is quoted in a single multicall
  and the best one wins.
- Price impact, LP fee, minimum received, slippage and the full route, all shown
  before you sign.
- ETH ⇄ WETH is detected and executed as a wrap, not a trade.
- Import any ERC-20 by address.

**Pool**

- Add liquidity to an existing pool at its current ratio, or create a new pool and
  set the starting price.
- Remove any percentage of a position, with the WETH side unwrapped back to native
  currency automatically.
- Your positions and every pool on the chain, with live reserves and prices.

**Chart**

- **Pool** — candles built from this DEX's own `Swap` events, so every pair has a
  chart, including tokens no price feed lists. Drawn with TradingView's
  Lightweight Charts.
- **Market** — TradingView's Advanced Chart, for pairs that map to a listed symbol
  (ETH/USDC, WBTC/USDC and similar).

---

## Quick start (local chain)

```bash
git clone https://github.com/cryko98/dex.git
cd dex
npm run setup
```

Then, in three terminals:

```bash
npm run chain        # terminal 1: local EVM node on :8545
npm run deploy       # terminal 2: deploy + seed demo tokens and pools
npm run dev          # terminal 3: web app on :5173
```

Point your wallet at `http://127.0.0.1:8545` (chain id `31337`) and import one of
the private keys the node printed.

Optional: `npm run simulate` generates ~120 trades so the price chart has history.

---

## Deploying to Robinhood Chain

The repo ships no guesses about the network — fill in the real values.

**1. Contracts**

```bash
cd contracts
cp .env.example .env
```

```ini
ROBINHOOD_RPC_URL=https://<rpc-endpoint>
ROBINHOOD_CHAIN_ID=<chain id>
PRIVATE_KEY=<deployer key, funded with gas>

# Set this if the chain already has a canonical wrapped-native token.
# Leave it empty to deploy the bundled WETH9.
WETH_ADDRESS=
```

```bash
npm run build
npm run deploy:robinhood
```

Addresses land in `contracts/deployments/<chainId>.json` and are copied into
`web/src/config/deployments.json` automatically.

**2. Web app**

```bash
cd web
cp .env.example .env
```

```ini
VITE_CHAIN_ID=<chain id>
VITE_CHAIN_NAME=Robinhood Chain
VITE_RPC_URL=https://<rpc-endpoint>
VITE_EXPLORER_URL=https://<explorer>
VITE_NATIVE_SYMBOL=ETH
VITE_ENABLE_LOCALHOST=false
```

```bash
npm run build
```

### Vercel

`vercel.json` is already set up: import the repo, and Vercel builds `web/` and
serves `web/dist`. Add the `VITE_*` variables above under **Settings →
Environment Variables**, then redeploy so the build picks them up.

The contract addresses are baked in at build time from
`web/src/config/deployments.json`, so commit that file after deploying the
contracts and redeploy the site.

---

## Contracts

| Contract     | Role                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| `RhoFactory` | Deploys one canonical pool per pair via CREATE2, holds the registry.        |
| `RhoPair`    | The pool: mint, burn, swap, a TWAP oracle, and an optional protocol fee.    |
| `RhoRouter`  | Slippage and deadline checks, multi-hop routing, native-currency wrapping.  |
| `RhoLens`    | Read-only aggregation, so the UI loads every pool in one call.              |
| `RhoLibrary` | Pricing maths shared by the router and off-chain quoting.                   |

Design notes:

- Uniswap V2's proven maths, ported to Solidity 0.8. Overflow checks are on
  everywhere except the two places V2 relies on wrapping (the TWAP accumulator and
  the block-timestamp delta), which stay in `unchecked` blocks.
- `RhoLibrary.pairFor` reads `factory.getPair` instead of recomputing the CREATE2
  address. That costs one `SLOAD` and removes the init-code-hash constant that
  silently breaks whenever compiler settings change.
- The first `MINIMUM_LIQUIDITY` (1000 wei) of LP supply is burned to a dead
  address, so the pool can never be drained to an empty, manipulable state.
- The protocol fee is off by default. `setFeeTo` turns on 1/6th of the LP fee;
  note that `kLast` only starts tracking at the first liquidity event *after* it
  is enabled.
- Fee-on-transfer tokens are supported through the
  `...SupportingFeeOnTransferTokens` router entry points.

```bash
cd contracts
npm test
```

```
  30 passing
```

Covers pool creation and sorting, LP accounting, the `k` invariant, the TWAP
oracle, the protocol fee, reentrancy through the flash-swap callback, every
router swap and liquidity path, EIP-2612 permit, mixed decimals, multi-hop
routing, slippage floors, deadlines and ETH refunds.

### Not audited

This is working, tested code, not audited code. Do not put funds you care about
into it without a professional review.

---

## Layout

```
contracts/
  contracts/
    core/        RhoFactory, RhoPair, RhoERC20
    periphery/   RhoRouter, RhoLens
    libraries/   RhoLibrary, Math, UQ112x112, TransferHelper
    mocks/       WETH9, TestToken, ReentrantCallee
  scripts/       deploy, seed, simulate, export-abi, sync-web
  test/          dex.test.js
web/
  src/
    abi/         generated from the Hardhat artifacts
    components/  swap card, chart, liquidity modals, token picker
    config/      chains, wagmi, tokens, deployed addresses
    hooks/       quoting, pools, balances, approvals, transactions
    pages/       Swap, Pool, Tokens
```

The web app never hand-writes an ABI: `contracts/scripts/export-abi.js` generates
`web/src/abi/index.ts` from the compiled artifacts as part of `npm run build`.
