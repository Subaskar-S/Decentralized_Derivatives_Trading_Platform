import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "hardhat-deploy";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000, // Optimized for L2 deployment frequency
      },
      viaIR: true, // Enable IR-based code generation for better optimization
      metadata: {
        bytecodeHash: "none", // Reduce deployment costs
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      gas: 30000000,
      gasPrice: 1000000000, // 1 gwei
      blockGasLimit: 30000000,
      allowUnlimitedContractSize: true,
    },
    optimism: {
      url: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
      chainId: 10,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gas: 15000000, // Optimism gas limit
      gasPrice: 1000000, // 0.001 gwei (very low on Optimism)
      verify: {
        etherscan: {
          apiKey: process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
          apiUrl: "https://api-optimistic.etherscan.io/",
        },
      },
    },
    optimismSepolia: {
      url: process.env.OPTIMISM_SEPOLIA_RPC_URL || "https://sepolia.optimism.io",
      chainId: 11155420,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gas: 15000000,
      gasPrice: 1000000,
      verify: {
        etherscan: {
          apiKey: process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
          apiUrl: "https://api-sepolia-optimistic.etherscan.io/",
        },
      },
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gas: 15000000,
      gasPrice: 1000000,
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gas: 30000000,
      gasPrice: 100000000, // 0.1 gwei
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    gasPrice: 0.001, // Optimism gas price in gwei
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    token: "ETH",
    gasPriceApi: "https://api.optimistic.etherscan.io/api?module=proxy&action=eth_gasPrice",
  },
  etherscan: {
    apiKey: {
      optimisticEthereum: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || "",
      optimisticSepolia: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "optimisticSepolia",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io/",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org/",
        },
      },
    ],
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
    only: [
      "DerivativesEngine",
      "PriceOracle",
      "AdvancedRiskManager",
      "AdvancedGovernance",
      "Treasury",
    ],
  },
  namedAccounts: {
    deployer: {
      default: 0,
      optimism: 0,
      optimismSepolia: 0,
      base: 0,
      arbitrum: 0,
    },
    treasury: {
      default: 1,
      optimism: "0x...", // Treasury multisig on Optimism
      optimismSepolia: 1,
    },
    guardian: {
      default: 2,
      optimism: "0x...", // Guardian multisig on Optimism
      optimismSepolia: 2,
    },
  },
  mocha: {
    timeout: 60000, // Increased timeout for L2 tests
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: "./deploy",
  },
};

export default config;
