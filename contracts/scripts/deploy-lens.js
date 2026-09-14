const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/**
 * Redeploys only RhoLens and points the web app at the new address.
 *
 * The lens holds no state and owns no funds - it just reads pools - so it can be
 * replaced on its own whenever its interface grows, without touching the factory,
 * the router, or anyone's liquidity.
 */
async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const file = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment for chain ${chainId}. Run deploy.js first.`);

  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const factory = deployment.contracts.factory;

  const Lens = await hre.ethers.getContractFactory("RhoLens");
  const lens = await Lens.deploy(factory);
  await lens.waitForDeployment();
  const address = await lens.getAddress();

  console.log(`RhoLens: ${deployment.contracts.lens} -> ${address}`);

  deployment.contracts.lens = address;
  fs.writeFileSync(file, `${JSON.stringify(deployment, null, 2)}\n`);

  require("./sync-web.js"); // refresh the address map the web app imports
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
