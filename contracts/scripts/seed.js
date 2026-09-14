const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { parseUnits, MaxUint256 } = hre.ethers;

/**
 * Deploys demo tokens and seeds pools with liquidity so the UI has something to trade
 * immediately. Intended for local and testnet use only.
 */
const DEMO_TOKENS = [
  { name: "USD Coin", symbol: "USDC", decimals: 6, supply: "10000000" },
  { name: "Tether USD", symbol: "USDT", decimals: 6, supply: "10000000" },
  { name: "Wrapped Bitcoin", symbol: "WBTC", decimals: 8, supply: "1000" },
  { name: "Robinhood Token", symbol: "HOOD", decimals: 18, supply: "5000000" },
];

// Pools created at seed time: [tokenA, amountA, tokenB, amountB]
const POOLS = [
  ["WETH", "40", "USDC", "120000"],
  ["WETH", "20", "HOOD", "200000"],
  ["USDC", "60000", "USDT", "60000"],
  ["WBTC", "2", "USDC", "180000"],
  ["HOOD", "100000", "USDC", "30000"],
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const file = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment for chain ${chainId}. Run deploy.js first.`);

  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const { router: routerAddress, weth: wethAddress } = deployment.contracts;
  const router = await hre.ethers.getContractAt("RhoRouter", routerAddress);

  console.log(`Seeding chain ${chainId} from ${deployer.address}`);

  // --- deploy demo tokens ------------------------------------------------
  const tokens = {
    WETH: { address: wethAddress, decimals: 18, symbol: "WETH", name: "Wrapped Ether" },
  };

  const TestToken = await hre.ethers.getContractFactory("TestToken");
  for (const t of DEMO_TOKENS) {
    const contract = await TestToken.deploy(t.name, t.symbol, t.decimals, parseUnits(t.supply, t.decimals));
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    tokens[t.symbol] = { address, decimals: t.decimals, symbol: t.symbol, name: t.name };
    console.log(`  ${t.symbol.padEnd(5)} ${address}`);

    const approve = await contract.approve(routerAddress, MaxUint256);
    await approve.wait();
  }

  // --- create pools ------------------------------------------------------
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  console.log("\nCreating pools:");
  for (const [symbolA, amountA, symbolB, amountB] of POOLS) {
    const a = tokens[symbolA];
    const b = tokens[symbolB];
    const rawA = parseUnits(amountA, a.decimals);
    const rawB = parseUnits(amountB, b.decimals);

    let tx;
    if (symbolA === "WETH") {
      // Pay with native currency and let the router wrap it.
      tx = await router.addLiquidityETH(b.address, rawB, 0, 0, deployer.address, deadline, { value: rawA });
    } else {
      tx = await router.addLiquidity(a.address, b.address, rawA, rawB, 0, 0, deployer.address, deadline);
    }
    await tx.wait();
    console.log(`  ${symbolA}/${symbolB}: ${amountA} + ${amountB}`);
  }

  deployment.tokens = Object.values(tokens);
  fs.writeFileSync(file, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nUpdated ${file}`);
  require("./sync-web.js"); // refresh the address map the web app imports
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
