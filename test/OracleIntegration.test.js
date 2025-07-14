const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Oracle Integration System", function () {
  // Test fixture for oracle deployment
  async function deployOracleSystemFixture() {
    const [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock Chainlink aggregators
    const MockChainlinkAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
    const ethUsdFeed = await MockChainlinkAggregator.deploy(8, "ETH/USD", 1);
    const btcUsdFeed = await MockChainlinkAggregator.deploy(8, "BTC/USD", 1);

    // Deploy mock Pyth contract
    const MockPyth = await ethers.getContractFactory("MockPyth");
    const pythContract = await MockPyth.deploy();

    // Deploy Chainlink oracle adapter
    const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
    const chainlinkOracle = await ChainlinkOracle.deploy();

    // Deploy Pyth oracle adapter
    const PythOracle = await ethers.getContractFactory("PythOracle");
    const pythOracle = await PythOracle.deploy(pythContract.target);

    // Deploy aggregated price oracle
    const AggregatedPriceOracle = await ethers.getContractFactory("AggregatedPriceOracle");
    const aggregatedOracle = await AggregatedPriceOracle.deploy();

    // Set up initial prices in mock feeds
    await ethUsdFeed.updateAnswer(ethers.parseUnits("2000", 8)); // $2000
    await btcUsdFeed.updateAnswer(ethers.parseUnits("40000", 8)); // $40000

    // Set up Pyth prices
    const ethPriceId = ethers.keccak256(ethers.toUtf8Bytes("ETH/USD"));
    const btcPriceId = ethers.keccak256(ethers.toUtf8Bytes("BTC/USD"));
    
    await pythContract.setPrice(
      ethPriceId,
      2000, // price
      10,   // confidence
      -8,   // expo (8 decimals)
      Math.floor(Date.now() / 1000) // current timestamp
    );

    await pythContract.setPrice(
      btcPriceId,
      40000, // price
      200,   // confidence
      -8,    // expo
      Math.floor(Date.now() / 1000)
    );

    // Configure Chainlink oracle
    await chainlinkOracle.addPriceFeed("ETH/USD", ethUsdFeed.target, 3600); // 1 hour heartbeat
    await chainlinkOracle.addPriceFeed("BTC/USD", btcUsdFeed.target, 3600);

    // Configure Pyth oracle
    await pythOracle.addPriceFeed("ETH/USD", ethPriceId, 100, 60); // 1% max confidence, 60s staleness
    await pythOracle.addPriceFeed("BTC/USD", btcPriceId, 200, 60); // 2% max confidence

    return {
      aggregatedOracle,
      chainlinkOracle,
      pythOracle,
      ethUsdFeed,
      btcUsdFeed,
      pythContract,
      ethPriceId,
      btcPriceId,
      owner,
      user1,
      user2,
    };
  }

  describe("Chainlink Oracle", function () {
    it("Should fetch price from Chainlink feed", async function () {
      const { chainlinkOracle } = await loadFixture(deployOracleSystemFixture);
      
      const priceData = await chainlinkOracle.getPrice("ETH/USD");
      expect(priceData.price).to.equal(ethers.parseEther("2000"));
      expect(priceData.isValid).to.be.true;
      expect(priceData.confidence).to.be.greaterThan(80);
    });

    it("Should handle stale prices", async function () {
      const { chainlinkOracle, ethUsdFeed } = await loadFixture(deployOracleSystemFixture);
      
      // Set a stale price (2 hours old)
      const staleTimestamp = Math.floor(Date.now() / 1000) - 7200;
      await ethUsdFeed.updateAnswerWithTimestamp(ethers.parseUnits("2000", 8), staleTimestamp);
      
      const priceData = await chainlinkOracle.getPrice("ETH/USD");
      expect(priceData.isValid).to.be.false;
    });

    it("Should validate price deviations", async function () {
      const { chainlinkOracle } = await loadFixture(deployOracleSystemFixture);
      
      // Set initial valid price
      await chainlinkOracle.updateLastValidPrice("ETH/USD", ethers.parseEther("2000"));
      
      // Test normal price (within 10% deviation)
      const normalPrice = ethers.parseEther("2100"); // 5% increase
      expect(await chainlinkOracle.validatePrice("ETH/USD", normalPrice)).to.be.true;
      
      // Test extreme price (over 10% deviation)
      const extremePrice = ethers.parseEther("2500"); // 25% increase
      expect(await chainlinkOracle.validatePrice("ETH/USD", extremePrice)).to.be.false;
    });

    it("Should manage price feeds", async function () {
      const { chainlinkOracle, owner } = await loadFixture(deployOracleSystemFixture);
      
      expect(await chainlinkOracle.isSymbolSupported("ETH/USD")).to.be.true;
      expect(await chainlinkOracle.isSymbolSupported("LINK/USD")).to.be.false;
      
      const symbols = await chainlinkOracle.getSupportedSymbols();
      expect(symbols).to.include("ETH/USD");
      expect(symbols).to.include("BTC/USD");
    });
  });

  describe("Pyth Oracle", function () {
    it("Should fetch price from Pyth feed", async function () {
      const { pythOracle } = await loadFixture(deployOracleSystemFixture);
      
      const priceData = await pythOracle.getPrice("ETH/USD");
      expect(priceData.price).to.equal(ethers.parseEther("2000"));
      expect(priceData.isValid).to.be.true;
      expect(priceData.confidence).to.be.greaterThan(0);
    });

    it("Should handle confidence intervals", async function () {
      const { pythOracle, pythContract, ethPriceId } = await loadFixture(deployOracleSystemFixture);
      
      // Set price with high confidence interval (low confidence)
      await pythContract.setPrice(
        ethPriceId,
        2000,  // price
        200,   // high confidence interval (10% of price)
        -8,    // expo
        Math.floor(Date.now() / 1000)
      );
      
      const priceData = await pythOracle.getPrice("ETH/USD");
      expect(priceData.confidence).to.be.lessThan(50); // Should have low confidence
    });

    it("Should get EMA prices", async function () {
      const { pythOracle, pythContract, ethPriceId } = await loadFixture(deployOracleSystemFixture);
      
      // Set EMA price
      await pythContract.setEmaPrice(
        ethPriceId,
        1980,  // slightly lower EMA price
        15,    // confidence
        -8,    // expo
        Math.floor(Date.now() / 1000)
      );
      
      const emaPrice = await pythOracle.getEmaPrice("ETH/USD");
      expect(emaPrice.price).to.equal(ethers.parseEther("1980"));
      expect(emaPrice.isValid).to.be.true;
    });

    it("Should handle price updates with fees", async function () {
      const { pythOracle, pythContract } = await loadFixture(deployOracleSystemFixture);
      
      const updateData = ["0x1234", "0x5678"]; // Mock update data
      const fee = await pythOracle.getUpdateFee(updateData);
      
      await expect(
        pythOracle.updatePriceFeeds(updateData, { value: fee })
      ).to.not.be.reverted;
    });
  });

  describe("Aggregated Price Oracle", function () {
    it("Should aggregate prices from multiple sources", async function () {
      const { aggregatedOracle, chainlinkOracle, pythOracle } = await loadFixture(deployOracleSystemFixture);
      
      // Add oracle sources
      await aggregatedOracle.addOracleSource(
        "ETH/USD",
        chainlinkOracle.target,
        "chainlink",
        70, // 70% weight
        1   // priority 1
      );
      
      await aggregatedOracle.addOracleSource(
        "ETH/USD",
        pythOracle.target,
        "pyth",
        30, // 30% weight
        2   // priority 2
      );
      
      // Update and get aggregated price
      await aggregatedOracle.updatePrice("ETH/USD");
      const priceData = await aggregatedOracle.getPrice("ETH/USD");
      
      expect(priceData.price).to.be.closeTo(ethers.parseEther("2000"), ethers.parseEther("10"));
      expect(priceData.isValid).to.be.true;
    });

    it("Should calculate TWAP correctly", async function () {
      const { aggregatedOracle, chainlinkOracle } = await loadFixture(deployOracleSystemFixture);
      
      await aggregatedOracle.addOracleSource(
        "ETH/USD",
        chainlinkOracle.target,
        "chainlink",
        100,
        1
      );
      
      // Update price multiple times to build history
      await aggregatedOracle.updatePrice("ETH/USD");
      
      // Wait and update again (simulate time passage)
      await ethers.provider.send("evm_increaseTime", [300]); // 5 minutes
      await aggregatedOracle.updatePrice("ETH/USD");
      
      const twap = await aggregatedOracle.getTWAP("ETH/USD", 600); // 10 minute TWAP
      expect(twap).to.be.greaterThan(0);
    });

    it("Should handle fallback mechanisms", async function () {
      const { aggregatedOracle, chainlinkOracle, pythOracle } = await loadFixture(deployOracleSystemFixture);
      
      // Add sources with different priorities
      await aggregatedOracle.addOracleSource("ETH/USD", chainlinkOracle.target, "chainlink", 50, 1);
      await aggregatedOracle.addOracleSource("ETH/USD", pythOracle.target, "pyth", 50, 2);
      
      // Configure to require multiple sources
      await aggregatedOracle.setMarketConfig("ETH/USD", {
        maxPriceDeviation: 500,  // 5%
        minConfidence: 80,
        maxPriceAge: 3600,
        requireMultipleSources: true
      });
      
      const priceData = await aggregatedOracle.getPrice("ETH/USD");
      expect(priceData.isValid).to.be.true;
    });

    it("Should validate market configurations", async function () {
      const { aggregatedOracle } = await loadFixture(deployOracleSystemFixture);
      
      // Valid configuration
      await expect(
        aggregatedOracle.setMarketConfig("ETH/USD", {
          maxPriceDeviation: 500,  // 5%
          minConfidence: 80,
          maxPriceAge: 3600,
          requireMultipleSources: false
        })
      ).to.not.be.reverted;
      
      // Invalid configuration (deviation too high)
      await expect(
        aggregatedOracle.setMarketConfig("ETH/USD", {
          maxPriceDeviation: 2500,  // 25% - too high
          minConfidence: 80,
          maxPriceAge: 3600,
          requireMultipleSources: false
        })
      ).to.be.revertedWith("Deviation too high");
    });

    it("Should handle emergency price overrides", async function () {
      const { aggregatedOracle, owner } = await loadFixture(deployOracleSystemFixture);
      
      const emergencyPrice = ethers.parseEther("1800");
      await aggregatedOracle.emergencySetPrice("ETH/USD", emergencyPrice, 90);
      
      const priceData = await aggregatedOracle.getPrice("ETH/USD");
      expect(priceData.price).to.equal(emergencyPrice);
      expect(priceData.confidence).to.equal(90);
      expect(priceData.isValid).to.be.true;
    });
  });

  describe("Integration with Derivatives Engine", function () {
    it("Should integrate with existing derivatives system", async function () {
      const { aggregatedOracle, chainlinkOracle } = await loadFixture(deployOracleSystemFixture);
      
      // Deploy a mock collateral token
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));
      
      // Deploy risk manager with aggregated oracle
      const RiskManager = await ethers.getContractFactory("RiskManager");
      const riskManager = await RiskManager.deploy(ethers.ZeroAddress, aggregatedOracle.target);
      
      // Deploy derivatives engine
      const DerivativesEngine = await ethers.getContractFactory("DerivativesEngine");
      const derivativesEngine = await DerivativesEngine.deploy(
        aggregatedOracle.target,
        riskManager.target,
        usdc.target
      );
      
      // Configure oracle
      await aggregatedOracle.addOracleSource("ETH/USD", chainlinkOracle.target, "chainlink", 100, 1);
      await aggregatedOracle.updatePrice("ETH/USD");
      
      // Add market to derivatives engine
      await derivativesEngine.addMarket("ETH/USD", 10);
      
      // Verify integration
      const market = await derivativesEngine.getMarket("ETH/USD");
      expect(market.isActive).to.be.true;
      
      const priceData = await aggregatedOracle.getPrice("ETH/USD");
      expect(priceData.isValid).to.be.true;
    });
  });
});
