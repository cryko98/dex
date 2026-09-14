const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { parseUnits, MaxUint256 } = hre.ethers;

/**
 * Generates trading history on a local chain so the price chart has candles to draw.
 * Local/testnet only - it mines blocks and moves time forward.
 */
const TRADES = 120;
const MINUTES_BETWEEN_TRADES = 20;

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const file = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment for chain ${chainId}. Run deploy.js first.`);

  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const { router: routerAddress, weth } = deployment.contracts;
  const router = await hre.ethers.getContractAt("RhoRouter", routerAddress);
  const [trader] = await hre.ethers.getSigners();

  const usdc = deployment.tokens.find((t) => t.symbol === "USDC");
  const hood = deployment.tokens.find((t) => t.symbol === "HOOD");
  if (!usdc || !hood) throw new Error("Seed the demo tokens first (npm run seed:local).");

  for (const token of [usdc, hood]) {
    const contract = await hre.ethers.getContractAt("TestToken", token.address);
    await (await contract.mint(trader.address, parseUnits("5000000", token.decimals))).wait();
    await (await contract.approve(routerAddress, MaxUint256)).wait();
  }

  console.log(`Simulating ${TRADES} trades on ${chainId}…`);

  for (let i = 0; i < TRADES; i++) {
    // Random direction and size, so the candles have some shape to them.
    const buy = Math.random() > 0.5;
    const size = 0.4 + Math.random() * 1.6;
    const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600;

    try {
      if (buy) {
        const amountIn = parseUnits((200 * size).toFixed(6), usdc.decimals);
        await (
          await router.swapExactTokensForTokens(amountIn, 0, [usdc.address, hood.address], trader.address, deadline)
        ).wait();
      } else {
        const amountIn = parseUnits((700 * size).toFixed(6), hood.decimals);
        await (
          await router.swapExactTokensForTokens(amountIn, 0, [hood.address, usdc.address], trader.address, deadline)
        ).wait();
      }

      // Also trade the WETH pool so that chart has data too.
      if (i % 4 === 0) {
        await (
          await router.swapExactETHForTokens(0, [weth, usdc.address], trader.address, deadline, {
            value: parseUnits((0.05 * size).toFixed(6), 18),
          })
        ).wait();
      }
    } catch (error) {
      console.warn(`  trade ${i} skipped: ${error.shortMessage ?? error.message}`);
    }

    await hre.network.provider.send("evm_increaseTime", [MINUTES_BETWEEN_TRADES * 60]);
    await hre.network.provider.send("evm_mine");
  }

  console.log("Done. Reload the web app to see the chart fill in.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
