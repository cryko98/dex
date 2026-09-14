const fs = require("fs");
const path = require("path");

/**
 * Merges every deployments/<chainId>.json into a single map the web app imports,
 * so the UI knows the contract addresses for whichever chain the wallet is on.
 */
const deploymentsDir = path.join(__dirname, "..", "deployments");
const outFile = path.join(__dirname, "..", "..", "web", "src", "config", "deployments.json");

const map = {};
if (fs.existsSync(deploymentsDir)) {
  for (const file of fs.readdirSync(deploymentsDir)) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(deploymentsDir, file), "utf8"));
    map[String(data.chainId)] = data;
  }
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(map, null, 2)}\n`);

const chains = Object.keys(map);
console.log(`Wrote ${outFile} (${chains.length ? `chains: ${chains.join(", ")}` : "no deployments yet"})`);
