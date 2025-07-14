import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy, log, execute } = deployments;
  const { deployer, treasury, guardian } = await getNamedAccounts();

  log(`Deploying L2 infrastructure on ${network.name}...`);

  // L2-specific configuration
  const isOptimism = network.name === "optimism" || network.name === "optimismSepolia";
  const isArbitrum = network.name === "arbitrum" || network.name === "arbitrumOne";
  const isBase = network.name === "base";

  // Deploy L2 Gas Manager first
  const gasManager = await deploy("L2GasManager", {
    from: deployer,
    args: [],
    log: true,
    gasLimit: 3000000,
    gasPrice: isOptimism ? "1000000" : undefined, // 0.001 gwei for Optimism
  });

  // Deploy Batch Executor
  const batchExecutor = await deploy("BatchExecutor", {
    from: deployer,
    args: [],
    log: true,
    gasLimit: 4000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy USDC mock for testnets
  let usdcAddress: string;
  if (network.name === "optimismSepolia" || network.name === "hardhat") {
    const mockUSDC = await deploy("MockERC20", {
      from: deployer,
      args: ["USD Coin", "USDC", ethers.parseEther("10000000")],
      log: true,
      gasLimit: 2000000,
    });
    usdcAddress = mockUSDC.address;
  } else if (network.name === "optimism") {
    usdcAddress = "0x7F5c764cBc14f9669B88837ca1490cCa17c31607"; // USDC on Optimism
  } else if (network.name === "arbitrum") {
    usdcAddress = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"; // USDC on Arbitrum
  } else if (network.name === "base") {
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
  } else {
    throw new Error(`USDC address not configured for network: ${network.name}`);
  }

  // Deploy Price Oracle with L2 optimizations
  const priceOracle = await deploy("PriceOracle", {
    from: deployer,
    args: [],
    log: true,
    gasLimit: 3500000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy Governance Token
  const governanceToken = await deploy("GovernanceToken", {
    from: deployer,
    args: [treasury, deployer],
    log: true,
    gasLimit: 3000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy Advanced Governance
  const governance = await deploy("AdvancedGovernance", {
    from: deployer,
    args: [governanceToken.address, guardian],
    log: true,
    gasLimit: 5000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy Treasury
  const treasuryContract = await deploy("Treasury", {
    from: deployer,
    args: [
      governance.address,
      ethers.ZeroAddress, // staking rewards pool
      ethers.ZeroAddress, // development fund
      ethers.ZeroAddress, // marketing fund
      ethers.ZeroAddress, // insurance fund
      ethers.ZeroAddress, // buyback contract
    ],
    log: true,
    gasLimit: 4000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy Advanced Risk Manager
  const riskManager = await deploy("AdvancedRiskManager", {
    from: deployer,
    args: [
      ethers.ZeroAddress, // Will set derivatives engine later
      priceOracle.address,
      usdcAddress,
    ],
    log: true,
    gasLimit: 6000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy Derivatives Engine
  const derivativesEngine = await deploy("DerivativesEngine", {
    from: deployer,
    args: [
      priceOracle.address,
      riskManager.address,
      usdcAddress,
    ],
    log: true,
    gasLimit: 7000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy Insurance Fund
  const insuranceFund = await deploy("InsuranceFund", {
    from: deployer,
    args: [
      usdcAddress,
      riskManager.address,
      derivativesEngine.address,
    ],
    log: true,
    gasLimit: 4000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy Liquidation Bot
  const liquidationBot = await deploy("LiquidationBot", {
    from: deployer,
    args: [
      riskManager.address,
      derivativesEngine.address,
      priceOracle.address,
      usdcAddress,
    ],
    log: true,
    gasLimit: 5000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  // Deploy Proposal Factory
  const proposalFactory = await deploy("ProposalFactory", {
    from: deployer,
    args: [
      governance.address,
      treasuryContract.address,
      riskManager.address,
      priceOracle.address,
      derivativesEngine.address,
    ],
    log: true,
    gasLimit: 4000000,
    gasPrice: isOptimism ? "1000000" : undefined,
  });

  log("Setting up contract relationships...");

  // Set derivatives engine in risk manager
  await execute(
    "AdvancedRiskManager",
    { from: deployer, gasLimit: 100000 },
    "setDerivativesEngine",
    derivativesEngine.address
  );

  // Authorize batch executor in gas manager
  await execute(
    "L2GasManager",
    { from: deployer, gasLimit: 100000 },
    "setAuthorizedCaller",
    batchExecutor.address,
    true
  );

  // Authorize batch executor in derivatives engine
  await execute(
    "BatchExecutor",
    { from: deployer, gasLimit: 100000 },
    "setAuthorizedCaller",
    deployer,
    true
  );

  // Add initial oracle and market for testing
  if (network.name !== "hardhat") {
    log("Adding initial oracle and market...");
    
    // Add mock oracle for ETH/USD
    await execute(
      "PriceOracle",
      { from: deployer, gasLimit: 200000 },
      "addOracle",
      deployer, // Mock oracle address
      "MockOracle",
      100
    );

    // Set initial price for ETH/USD
    await execute(
      "PriceOracle",
      { from: deployer, gasLimit: 150000 },
      "emergencySetPrice",
      "ETH/USD",
      ethers.parseEther("2500"), // $2500
      95
    );

    // Add ETH/USD market
    await execute(
      "DerivativesEngine",
      { from: deployer, gasLimit: 200000 },
      "addMarket",
      "ETH/USD",
      25 // 25x max leverage
    );
  }

  // Enable trading on governance token
  await execute(
    "GovernanceToken",
    { from: deployer, gasLimit: 100000 },
    "enableTrading"
  );

  log("L2 infrastructure deployment completed!");

  // Log deployment addresses
  log("=== Deployment Addresses ===");
  log(`L2GasManager: ${gasManager.address}`);
  log(`BatchExecutor: ${batchExecutor.address}`);
  log(`PriceOracle: ${priceOracle.address}`);
  log(`GovernanceToken: ${governanceToken.address}`);
  log(`AdvancedGovernance: ${governance.address}`);
  log(`Treasury: ${treasuryContract.address}`);
  log(`AdvancedRiskManager: ${riskManager.address}`);
  log(`DerivativesEngine: ${derivativesEngine.address}`);
  log(`InsuranceFund: ${insuranceFund.address}`);
  log(`LiquidationBot: ${liquidationBot.address}`);
  log(`ProposalFactory: ${proposalFactory.address}`);
  log(`USDC: ${usdcAddress}`);

  // Save deployment info for frontend
  const deploymentInfo = {
    network: network.name,
    chainId: network.config.chainId,
    contracts: {
      L2GasManager: gasManager.address,
      BatchExecutor: batchExecutor.address,
      PriceOracle: priceOracle.address,
      GovernanceToken: governanceToken.address,
      AdvancedGovernance: governance.address,
      Treasury: treasuryContract.address,
      AdvancedRiskManager: riskManager.address,
      DerivativesEngine: derivativesEngine.address,
      InsuranceFund: insuranceFund.address,
      LiquidationBot: liquidationBot.address,
      ProposalFactory: proposalFactory.address,
      USDC: usdcAddress,
    },
    deployer,
    treasury,
    guardian,
    timestamp: new Date().toISOString(),
  };

  // Write deployment info to file
  const fs = require("fs");
  const path = require("path");
  
  const deploymentDir = path.join(__dirname, "../deployments", network.name);
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(deploymentDir, "deployment-info.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  log(`Deployment info saved to deployments/${network.name}/deployment-info.json`);
};

export default func;
func.tags = ["L2Infrastructure", "Core"];
func.dependencies = [];
