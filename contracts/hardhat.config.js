require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

/**
 * Robinhood Chain endpoints are read from .env so this repo carries no guesses about
 * the network. See .env.example for the values to fill in.
 */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 999999 },
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    robinhood: {
      url: process.env.ROBINHOOD_RPC_URL || "",
      chainId: process.env.ROBINHOOD_CHAIN_ID ? Number(process.env.ROBINHOOD_CHAIN_ID) : undefined,
      accounts,
    },
    robinhoodTestnet: {
      url: process.env.ROBINHOOD_TESTNET_RPC_URL || "",
      chainId: process.env.ROBINHOOD_TESTNET_CHAIN_ID
        ? Number(process.env.ROBINHOOD_TESTNET_CHAIN_ID)
        : undefined,
      accounts,
    },
  },
  etherscan: {
    apiKey: process.env.EXPLORER_API_KEY || "",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
  },
};
