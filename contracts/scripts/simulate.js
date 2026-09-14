const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { parseUnits, MaxUint256 } = hre.ethers;

/**
 * Generates trading history across every seeded pool so the explorer has real
 * volume, transaction counts, makers and price action to display.
 * Local and testnet only - it mines blocks and moves time forward.
 */
const ROUNDS = 260;
const SECONDS_BETWEEN_ROUNDS = 260;

/** Rough per-trade notional in the quote asset, to keep price impact sane. */
const TRADE_SIZES = {
  USDC: 400,
  USDT: 400,
  WETH: 0.15,
  WBTC: 0.01,
  HOOD: 900,
};

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const file = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment for chain ${chainId}. Run deploy.js first.`);

  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const { router: routerAddress, factory: factoryAddress, weth } = deployment.contracts;
  const router = await hre.ethers.getContractAt("RhoRouter", routerAddress);
  const factory = await hre.ethers.getContractAt("RhoFactory", factoryAddress);

  // Several traders, so the explorer's "makers" count is meaningful.
  const signers = (await hre.ethers.getSigners()).slice(0, 8);
  const [funder] = signers;

  const byAddress = new Map(deployment.tokens.map((t) => [t.address.toLowerCase(), t]));
  const wethToken = deployment.tokens.find((t) => t.address.toLowerCase() === weth.toLowerCase());

  // Fund and approve every trader for every ERC-20 in the deployment.
  console.log(`Funding ${signers.length} traders…`);
  for (const token of deployment.tokens) {
    if (token.address.toLowerCase() === weth.toLowerCase()) continue;
    const contract = await hre.ethers.getContractAt("TestToken", token.address);
    for (const signer of signers) {
      await (await contract.mint(signer.address, parseUnits("2000000", token.decimals))).wait();
      await (await contract.connect(signer).approve(routerAddress, MaxUint256)).wait();
    }
  }

  // Every pool the factory knows about, resolved back to token metadata.
  const pairCount = Number(await factory.allPairsLength());
  const pools = [];
  for (let i = 0; i < pairCount; i++) {
    const pairAddress = await factory.allPairs(i);
    const pair = await hre.ethers.getContractAt("RhoPair", pairAddress);
    const token0 = byAddress.get((await pair.token0()).toLowerCase());
    const token1 = byAddress.get((await pair.token1()).toLowerCase());
    if (token0 && token1) pools.push({ token0, token1 });
  }
  if (pools.length === 0) throw new Error("No pools found. Run seed.js first.");

  console.log(`Simulating ${ROUNDS} rounds across ${pools.length} pools…`);

  let executed = 0;
  let skipped = 0;

  for (let round = 0; round < ROUNDS; round++) {
    const pool = pools[Math.floor(Math.random() * pools.length)];
    const trader = signers[Math.floor(Math.random() * signers.length)];

    // Random direction, with a mild drift so the charts trend rather than oscillate.
    const drift = Math.sin(round / 22) * 0.18;
    const sellBase = Math.random() > 0.5 + drift;
    const [inToken, outToken] = sellBase ? [pool.token0, pool.token1] : [pool.token1, pool.token0];

    const notional = TRADE_SIZES[inToken.symbol] ?? 100;
    const size = notional * (0.35 + Math.random() * 1.5);
    const amountIn = parseUnits(size.toFixed(Math.min(6, inToken.decimals)), inToken.decimals);
    const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600;

    try {
      const isNativeIn = inToken.address.toLowerCase() === weth.toLowerCase();
      if (isNativeIn) {
        await (
          await router
            .connect(trader)
            .swapExactETHForTokens(0, [inToken.address, outToken.address], trader.address, deadline, {
              value: amountIn,
            })
        ).wait();
      } else {
        await (
          await router
            .connect(trader)
            .swapExactTokensForTokens(
              amountIn,
              0,
              [inToken.address, outToken.address],
              trader.address,
              deadline,
            )
        ).wait();
      }
      executed++;
    } catch (error) {
      skipped++;
      if (skipped < 4) console.warn(`  round ${round} skipped: ${error.shortMessage ?? error.message}`);
    }

    // Occasionally top the funder's wrapped balance back up, so WETH pools stay tradable.
    if (wethToken && round % 50 === 0) {
      const wethContract = await hre.ethers.getContractAt("WETH9", weth);
      await (await wethContract.connect(funder).deposit({ value: parseUnits("5", 18) })).wait();
      await (await wethContract.connect(funder).approve(routerAddress, MaxUint256)).wait();
    }

    await hre.network.provider.send("evm_increaseTime", [SECONDS_BETWEEN_ROUNDS]);
    await hre.network.provider.send("evm_mine");
  }

  console.log(`Done: ${executed} trades, ${skipped} skipped. Reload the app to see the explorer fill in.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
