const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { parseUnits, MaxUint256 } = hre.ethers;

/**
 * Deploys a second AMM on the same chain - a stand-in for another DEX - and lists a
 * handful of community tokens on it.
 *
 * The explorer discovers pools from PairCreated events rather than a hard-coded
 * factory list, so everything created here shows up without the app being told about
 * it. That is the behaviour this script exists to demonstrate. Local and testnet only.
 */
const MEME_TOKENS = [
  { name: "Feather", symbol: "FTHR", decimals: 18, supply: "1000000000", usdc: "45000", tokens: "120000000" },
  { name: "Green Candle", symbol: "CNDL", decimals: 18, supply: "420690000", usdc: "18000", tokens: "90000000" },
  { name: "Diamond Hands", symbol: "DMND", decimals: 18, supply: "88000000", usdc: "62000", tokens: "12000000" },
  { name: "Moon Boi", symbol: "MOON", decimals: 9, supply: "69000000", usdc: "7500", tokens: "8000000" },
];

/** Trades run after listing, so the pairs have price history and makers. */
const TRADE_ROUNDS = 90;
const SECONDS_BETWEEN_ROUNDS = 420;

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const file = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment for chain ${chainId}. Run deploy.js first.`);

  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const usdc = deployment.tokens.find((t) => t.symbol === "USDC");
  if (!usdc) throw new Error("Seed the demo tokens first (npm run seed:local).");

  const signers = (await hre.ethers.getSigners()).slice(0, 8);
  const [deployer] = signers;

  // A separate factory and router: as far as the chain is concerned, a different DEX.
  const Factory = await hre.ethers.getContractFactory("RhoFactory");
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  const Router = await hre.ethers.getContractFactory("RhoRouter");
  const router = await Router.deploy(factoryAddress, deployment.contracts.weth);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  console.log(`Community DEX factory: ${factoryAddress}`);
  console.log(`Community DEX router:  ${routerAddress}\n`);

  const usdcContract = await hre.ethers.getContractAt("TestToken", usdc.address);
  const TestToken = await hre.ethers.getContractFactory("TestToken");

  const listed = [];

  for (const meme of MEME_TOKENS) {
    const token = await TestToken.deploy(
      meme.name,
      meme.symbol,
      meme.decimals,
      parseUnits(meme.supply, meme.decimals),
    );
    await token.waitForDeployment();
    const address = await token.getAddress();

    // Fund and approve every trader on both sides of the new pair.
    for (const signer of signers) {
      await (await token.mint(signer.address, parseUnits(meme.tokens, meme.decimals))).wait();
      await (await token.connect(signer).approve(routerAddress, MaxUint256)).wait();
      await (await usdcContract.mint(signer.address, parseUnits("500000", usdc.decimals))).wait();
      await (await usdcContract.connect(signer).approve(routerAddress, MaxUint256)).wait();
    }

    const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
    await (
      await router.addLiquidity(
        address,
        usdc.address,
        parseUnits(meme.tokens, meme.decimals),
        parseUnits(meme.usdc, usdc.decimals),
        0,
        0,
        deployer.address,
        deadline,
      )
    ).wait();

    listed.push({ ...meme, address });
    console.log(`  ${meme.symbol.padEnd(5)} ${address}  ${meme.tokens} ${meme.symbol} / ${meme.usdc} USDC`);
  }

  console.log(`\nTrading ${TRADE_ROUNDS} rounds across ${listed.length} community pairs…`);

  let executed = 0;
  for (let round = 0; round < TRADE_ROUNDS; round++) {
    const meme = listed[Math.floor(Math.random() * listed.length)];
    const trader = signers[Math.floor(Math.random() * signers.length)];

    // Memecoins are volatile, so bias the sizes larger relative to the pool.
    const buy = Math.random() > 0.45;
    const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600;

    try {
      if (buy) {
        const amountIn = parseUnits((80 + Math.random() * 900).toFixed(6), usdc.decimals);
        await (
          await router
            .connect(trader)
            .swapExactTokensForTokens(amountIn, 0, [usdc.address, meme.address], trader.address, deadline)
        ).wait();
      } else {
        const size = Number(meme.tokens) * (0.0004 + Math.random() * 0.004);
        const amountIn = parseUnits(size.toFixed(Math.min(6, meme.decimals)), meme.decimals);
        await (
          await router
            .connect(trader)
            .swapExactTokensForTokens(amountIn, 0, [meme.address, usdc.address], trader.address, deadline)
        ).wait();
      }
      executed++;
    } catch (error) {
      if (executed === 0) console.warn(`  round ${round} skipped: ${error.shortMessage ?? error.message}`);
    }

    await hre.network.provider.send("evm_increaseTime", [SECONDS_BETWEEN_ROUNDS]);
    await hre.network.provider.send("evm_mine");
  }

  deployment.externalDexes = [
    ...(deployment.externalDexes ?? []),
    { name: "Community DEX", factory: factoryAddress, router: routerAddress, tokens: listed.map((t) => t.symbol) },
  ];
  fs.writeFileSync(file, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`\nDone: ${executed} trades. These pools belong to a different factory,`);
  console.log("so the explorer finding them proves chain-wide discovery works.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
