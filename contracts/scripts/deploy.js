const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/**
 * Deploys the full DEX and writes the addresses to deployments/<chainId>.json,
 * which the web app reads at build time.
 */
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log(`Deploying to chainId ${chainId} as ${deployer.address}`);
  console.log(`Balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))}`);

  // Use the chain's canonical wrapped-native token when one exists; otherwise deploy WETH9.
  let wethAddress = process.env.WETH_ADDRESS;
  if (!wethAddress) {
    const WETH9 = await hre.ethers.getContractFactory("WETH9");
    const weth = await WETH9.deploy();
    await weth.waitForDeployment();
    wethAddress = await weth.getAddress();
    console.log(`WETH9 deployed:    ${wethAddress}`);
  } else {
    console.log(`WETH (existing):   ${wethAddress}`);
  }

  const feeToSetter = process.env.FEE_TO_SETTER || deployer.address;

  const Factory = await hre.ethers.getContractFactory("RhoFactory");
  const factory = await Factory.deploy(feeToSetter);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`RhoFactory:        ${factoryAddress}`);

  const Router = await hre.ethers.getContractFactory("RhoRouter");
  const router = await Router.deploy(factoryAddress, wethAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`RhoRouter:         ${routerAddress}`);

  const Lens = await hre.ethers.getContractFactory("RhoLens");
  const lens = await Lens.deploy(factoryAddress);
  await lens.waitForDeployment();
  const lensAddress = await lens.getAddress();
  console.log(`RhoLens:           ${lensAddress}`);

  const pairCodeHash = await factory.pairCodeHash();
  console.log(`pairCodeHash:      ${pairCodeHash}`);

  const deployment = {
    chainId,
    name: hre.network.name,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      factory: factoryAddress,
      router: routerAddress,
      lens: lensAddress,
      weth: wethAddress,
    },
    pairCodeHash,
    tokens: [],
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${chainId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`\nWrote ${file}`);
  console.log("Next: npm run seed:<network> to create demo tokens and pools.");
  require("./sync-web.js"); // refresh the address map the web app imports
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
