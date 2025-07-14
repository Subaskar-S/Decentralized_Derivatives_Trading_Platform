const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Optimism Mainnet Chainlink Price Feed Addresses
const CHAINLINK_FEEDS = {
  "ETH/USD": "0x13e3Ee699D1909E989722E753853AE30b17e08c5",
  "BTC/USD": "0xD702DD976Fb76Fffc2D3963D037dfDae5b04E593",
  "LINK/USD": "0xCc232dcFAAE6354cE191Bd574108c1aD03f86450",
  "OP/USD": "0x0D276FC14719f9292D5C1eA2198673d1f4269246",
};

// Pyth Network Contract on Optimism
const PYTH_CONTRACT = "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C";

// Pyth Price IDs
const PYTH_PRICE_IDS = {
  "ETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "BTC/USD": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "LINK/USD": "0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221",
  "OP/USD": "0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf",
};

async function main() {
  console.log("Starting Oracle System deployment...");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "Chain ID:", network.chainId);

  const deployments = {};

  try {
    // 1. Deploy Chainlink Oracle Adapter
    console.log("Deploying ChainlinkOracle...");
    const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
    const chainlinkOracle = await ChainlinkOracle.deploy();
    await chainlinkOracle.waitForDeployment();
    deployments.chainlinkOracle = chainlinkOracle.target;
    console.log("ChainlinkOracle deployed to:", chainlinkOracle.target);

    // 2. Deploy Pyth Oracle Adapter
    console.log("Deploying PythOracle...");
    const PythOracle = await ethers.getContractFactory("PythOracle");
    const pythOracle = await PythOracle.deploy(PYTH_CONTRACT);
    await pythOracle.waitForDeployment();
    deployments.pythOracle = pythOracle.target;
    console.log("PythOracle deployed to:", pythOracle.target);

    // 3. Deploy Aggregated Price Oracle
    console.log("Deploying AggregatedPriceOracle...");
    const AggregatedPriceOracle = await ethers.getContractFactory("AggregatedPriceOracle");
    const aggregatedOracle = await AggregatedPriceOracle.deploy();
    await aggregatedOracle.waitForDeployment();
    deployments.aggregatedOracle = aggregatedOracle.target;
    console.log("AggregatedPriceOracle deployed to:", aggregatedOracle.target);

    // 4. Configure Chainlink Oracle
    console.log("Configuring Chainlink Oracle...");
    for (const [symbol, feedAddress] of Object.entries(CHAINLINK_FEEDS)) {
      console.log(`Adding Chainlink feed for ${symbol}: ${feedAddress}`);
      await chainlinkOracle.addPriceFeed(symbol, feedAddress, 3600); // 1 hour heartbeat
    }

    // 5. Configure Pyth Oracle
    console.log("Configuring Pyth Oracle...");
    for (const [symbol, priceId] of Object.entries(PYTH_PRICE_IDS)) {
      console.log(`Adding Pyth feed for ${symbol}: ${priceId}`);
      await pythOracle.addPriceFeed(
        symbol,
        priceId,
        500, // 5% max confidence ratio
        60   // 60 seconds max staleness
      );
    }

    // 6. Configure Aggregated Oracle
    console.log("Configuring Aggregated Oracle...");
    const symbols = Object.keys(CHAINLINK_FEEDS);
    
    for (const symbol of symbols) {
      console.log(`Setting up aggregation for ${symbol}...`);
      
      // Add Chainlink source (70% weight, priority 1)
      await aggregatedOracle.addOracleSource(
        symbol,
        chainlinkOracle.target,
        "chainlink",
        70, // 70% weight
        1   // priority 1 (highest)
      );
      
      // Add Pyth source (30% weight, priority 2)
      await aggregatedOracle.addOracleSource(
        symbol,
        pythOracle.target,
        "pyth",
        30, // 30% weight
        2   // priority 2
      );
      
      // Set market configuration
      await aggregatedOracle.setMarketConfig(symbol, {
        maxPriceDeviation: 500,  // 5% max deviation
        minConfidence: 80,       // 80% min confidence
        maxPriceAge: 3600,       // 1 hour max age
        requireMultipleSources: true
      });
    }

    // 7. Test price updates
    console.log("Testing price updates...");
    for (const symbol of symbols.slice(0, 2)) { // Test first 2 symbols
      try {
        await aggregatedOracle.updatePrice(symbol);
        const priceData = await aggregatedOracle.getPrice(symbol);
        console.log(`${symbol} price: ${ethers.formatEther(priceData.price)} (confidence: ${priceData.confidence}%)`);
      } catch (error) {
        console.log(`Warning: Could not update price for ${symbol}:`, error.message);
      }
    }

    console.log("Oracle system deployment completed successfully!");

    // Save deployment addresses
    const deploymentsDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    const deploymentFile = path.join(deploymentsDir, `oracles-${network.name}-${network.chainId}.json`);
    const deploymentData = {
      network: network.name,
      chainId: network.chainId,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      contracts: deployments,
      configuration: {
        chainlinkFeeds: CHAINLINK_FEEDS,
        pythContract: PYTH_CONTRACT,
        pythPriceIds: PYTH_PRICE_IDS,
        supportedSymbols: symbols
      }
    };
    
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentData, null, 2));
    console.log("Deployment data saved to:", deploymentFile);

    // Generate integration code
    console.log("\n=== Integration Code ===");
    console.log("// Add to your derivatives engine deployment:");
    console.log(`const aggregatedOracle = "${deployments.aggregatedOracle}";`);
    console.log("// Use this address when deploying DerivativesEngine and RiskManager");
    
  } catch (error) {
    console.error("Oracle deployment failed:", error);
    process.exit(1);
  }
}

// Helper function to deploy mock oracles for testing
async function deployMockOracles() {
  console.log("Deploying mock oracles for testing...");
  
  const deployments = {};
  
  // Deploy mock Chainlink aggregators
  const MockChainlinkAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
  
  const ethUsdFeed = await MockChainlinkAggregator.deploy(8, "ETH/USD", 1);
  await ethUsdFeed.waitForDeployment();
  deployments.ethUsdFeed = ethUsdFeed.target;
  
  const btcUsdFeed = await MockChainlinkAggregator.deploy(8, "BTC/USD", 1);
  await btcUsdFeed.waitForDeployment();
  deployments.btcUsdFeed = btcUsdFeed.target;
  
  // Deploy mock Pyth contract
  const MockPyth = await ethers.getContractFactory("MockPyth");
  const mockPyth = await MockPyth.deploy();
  await mockPyth.waitForDeployment();
  deployments.mockPyth = mockPyth.target;
  
  // Set initial prices
  await ethUsdFeed.updateAnswer(ethers.parseUnits("2000", 8));
  await btcUsdFeed.updateAnswer(ethers.parseUnits("40000", 8));
  
  const ethPriceId = ethers.keccak256(ethers.toUtf8Bytes("ETH/USD"));
  const btcPriceId = ethers.keccak256(ethers.toUtf8Bytes("BTC/USD"));
  
  await mockPyth.setPrice(ethPriceId, 2000, 10, -8, Math.floor(Date.now() / 1000));
  await mockPyth.setPrice(btcPriceId, 40000, 200, -8, Math.floor(Date.now() / 1000));
  
  console.log("Mock oracles deployed:", deployments);
  return deployments;
}

// Export functions for use in other scripts
module.exports = {
  main,
  deployMockOracles,
  CHAINLINK_FEEDS,
  PYTH_CONTRACT,
  PYTH_PRICE_IDS
};

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
