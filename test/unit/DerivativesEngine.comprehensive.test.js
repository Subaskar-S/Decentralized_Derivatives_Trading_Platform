const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const testConfig = require("../config/test.config.js");

describe("DerivativesEngine - Comprehensive Unit Tests", function () {
  // Test fixture
  async function deployDerivativesFixture() {
    const [owner, trader1, trader2, trader3, liquidator, keeper] = await ethers.getSigners();

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", testConfig.INITIAL_USDC_SUPPLY);

    // Deploy price oracle
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    const priceOracle = await PriceOracle.deploy();

    // Deploy risk manager
    const AdvancedRiskManager = await ethers.getContractFactory("AdvancedRiskManager");
    const riskManager = await AdvancedRiskManager.deploy(
      ethers.ZeroAddress,
      priceOracle.target,
      usdc.target
    );

    // Deploy derivatives engine
    const DerivativesEngine = await ethers.getContractFactory("DerivativesEngine");
    const derivativesEngine = await DerivativesEngine.deploy(
      priceOracle.target,
      riskManager.target,
      usdc.target
    );

    // Set derivatives engine in risk manager
    await riskManager.setDerivativesEngine(derivativesEngine.target);

    // Setup oracle and markets
    await priceOracle.addOracle(owner.address, "MockOracle", 100);
    await testConfig.setupMarket(derivativesEngine, priceOracle, "ETH/USD", 2500, 25);
    await testConfig.setupMarket(derivativesEngine, priceOracle, "BTC/USD", 45000, 20);

    // Mint and approve USDC for traders
    for (const trader of [trader1, trader2, trader3]) {
      await testConfig.mintAndApprove(usdc, trader, 100000, derivativesEngine.target);
    }

    return {
      derivativesEngine,
      priceOracle,
      riskManager,
      usdc,
      owner,
      trader1,
      trader2,
      trader3,
      liquidator,
      keeper,
    };
  }

  describe("Position Management", function () {
    it("Should open a long position correctly", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      const size = ethers.parseEther("10000"); // $10,000
      const collateral = ethers.parseEther("1000"); // $1,000 (10x leverage)
      
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        size,
        collateral,
        true, // isLong
        testConfig.DEFAULT_SLIPPAGE
      );
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      
      // Check gas usage is within expected range
      expect(gasUsed).to.be.lte(testConfig.EXPECTED_GAS_USAGE.openPosition);
      
      // Verify position was created
      await testConfig.expectEvent(tx, derivativesEngine.interface, "PositionOpened", {
        trader: trader1.address,
        symbol: "ETH/USD",
        size: size,
        collateral: collateral,
        isLong: true
      });
    });

    it("Should open a short position correctly", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      const size = ethers.parseEther("5000");
      const collateral = ethers.parseEther("1000");
      
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        size,
        collateral,
        false, // isShort
        testConfig.DEFAULT_SLIPPAGE
      );
      
      await testConfig.expectEvent(tx, derivativesEngine.interface, "PositionOpened", {
        trader: trader1.address,
        isLong: false
      });
    });

    it("Should reject position with insufficient collateral", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      const size = ethers.parseEther("10000");
      const collateral = ethers.parseEther("100"); // Only 100x leverage, should fail
      
      await testConfig.expectRevert(
        derivativesEngine.connect(trader1).openPosition(
          "ETH/USD",
          size,
          collateral,
          true,
          testConfig.DEFAULT_SLIPPAGE
        ),
        "Leverage too high"
      );
    });

    it("Should reject position on inactive market", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      await testConfig.expectRevert(
        derivativesEngine.connect(trader1).openPosition(
          "INVALID/USD",
          ethers.parseEther("1000"),
          ethers.parseEther("100"),
          true,
          testConfig.DEFAULT_SLIPPAGE
        ),
        "Market not active"
      );
    });

    it("Should close position with profit", async function () {
      const { derivativesEngine, priceOracle, trader1 } = await loadFixture(deployDerivativesFixture);
      
      // Open long position
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        trader1,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      // Increase price to create profit
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2750"), 95); // +10%
      
      const tx = await derivativesEngine.connect(trader1).closePosition(
        positionId,
        testConfig.DEFAULT_SLIPPAGE
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "PositionClosed"
      );
      
      expect(event.args.pnl).to.be.gt(0); // Should have profit
    });

    it("Should close position with loss", async function () {
      const { derivativesEngine, priceOracle, trader1 } = await loadFixture(deployDerivativesFixture);
      
      // Open long position
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        trader1,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      // Decrease price to create loss
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2250"), 95); // -10%
      
      const tx = await derivativesEngine.connect(trader1).closePosition(
        positionId,
        testConfig.DEFAULT_SLIPPAGE
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "PositionClosed"
      );
      
      expect(event.args.pnl).to.be.lt(0); // Should have loss
    });
  });

  describe("Collateral Management", function () {
    it("Should add collateral to position", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        trader1,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      const additionalCollateral = ethers.parseEther("500");
      
      const tx = await derivativesEngine.connect(trader1).addCollateral(
        positionId,
        additionalCollateral
      );
      
      await testConfig.expectEvent(tx, derivativesEngine.interface, "CollateralAdded", {
        positionId: positionId
      });
    });

    it("Should remove collateral from position", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        trader1,
        "ETH/USD",
        10000,
        2000, // Higher collateral
        true
      );
      
      const collateralToRemove = ethers.parseEther("500");
      
      const tx = await derivativesEngine.connect(trader1).removeCollateral(
        positionId,
        collateralToRemove
      );
      
      await testConfig.expectEvent(tx, derivativesEngine.interface, "CollateralRemoved", {
        positionId: positionId
      });
    });

    it("Should reject removing too much collateral", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        trader1,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      const excessiveCollateral = ethers.parseEther("900"); // Would make position under-collateralized
      
      await testConfig.expectRevert(
        derivativesEngine.connect(trader1).removeCollateral(
          positionId,
          excessiveCollateral
        ),
        "Insufficient collateral"
      );
    });
  });

  describe("Market Management", function () {
    it("Should add new market", async function () {
      const { derivativesEngine, priceOracle, owner } = await loadFixture(deployDerivativesFixture);
      
      await priceOracle.emergencySetPrice("SOL/USD", testConfig.SOL_PRICE, 95);
      
      const tx = await derivativesEngine.connect(owner).addMarket("SOL/USD", 15);
      
      await testConfig.expectEvent(tx, derivativesEngine.interface, "MarketAdded", {
        symbol: "SOL/USD",
        maxLeverage: 15
      });
      
      const market = await derivativesEngine.markets("SOL/USD");
      expect(market.isActive).to.be.true;
      expect(market.maxLeverage).to.equal(15);
    });

    it("Should update market parameters", async function () {
      const { derivativesEngine, owner } = await loadFixture(deployDerivativesFixture);
      
      const tx = await derivativesEngine.connect(owner).updateMarket("ETH/USD", 30, true);
      
      const market = await derivativesEngine.markets("ETH/USD");
      expect(market.maxLeverage).to.equal(30);
      expect(market.isActive).to.be.true;
    });

    it("Should deactivate market", async function () {
      const { derivativesEngine, owner } = await loadFixture(deployDerivativesFixture);
      
      await derivativesEngine.connect(owner).updateMarket("ETH/USD", 25, false);
      
      const market = await derivativesEngine.markets("ETH/USD");
      expect(market.isActive).to.be.false;
    });

    it("Should reject non-owner market operations", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      await testConfig.expectRevert(
        derivativesEngine.connect(trader1).addMarket("INVALID/USD", 10),
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("Funding Rate Mechanism", function () {
    it("Should update funding rate based on open interest", async function () {
      const { derivativesEngine, trader1, trader2 } = await loadFixture(deployDerivativesFixture);
      
      // Create imbalanced positions (more longs)
      await testConfig.createPosition(derivativesEngine, trader1, "ETH/USD", 10000, 1000, true);
      await testConfig.createPosition(derivativesEngine, trader2, "ETH/USD", 5000, 500, true);
      
      // Advance time to trigger funding rate update
      await testConfig.increaseTime(testConfig.SECONDS_IN_HOUR);
      
      const tx = await derivativesEngine.updateFundingRate("ETH/USD");
      
      await testConfig.expectEvent(tx, derivativesEngine.interface, "FundingRateUpdated");
      
      const market = await derivativesEngine.markets("ETH/USD");
      expect(market.fundingRate).to.not.equal(0);
    });

    it("Should apply funding payments correctly", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        trader1,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      // Set funding rate
      await derivativesEngine.updateFundingRate("ETH/USD");
      
      // Advance time
      await testConfig.increaseTime(testConfig.SECONDS_IN_HOUR);
      
      const positionBefore = await derivativesEngine.getPosition(positionId);
      
      // Apply funding
      await derivativesEngine.applyFunding(positionId);
      
      const positionAfter = await derivativesEngine.getPosition(positionId);
      
      // Funding should have been applied
      expect(positionAfter.fundingIndex).to.not.equal(positionBefore.fundingIndex);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle zero-sized positions", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      await testConfig.expectRevert(
        derivativesEngine.connect(trader1).openPosition(
          "ETH/USD",
          0,
          ethers.parseEther("1000"),
          true,
          testConfig.DEFAULT_SLIPPAGE
        ),
        "Invalid size"
      );
    });

    it("Should handle maximum position size", async function () {
      const { derivativesEngine, trader1, usdc } = await loadFixture(deployDerivativesFixture);
      
      // Mint large amount for max position test
      await usdc.mint(trader1.address, ethers.parseEther("10000000"));
      await usdc.connect(trader1).approve(derivativesEngine.target, ethers.parseEther("10000000"));
      
      const maxSize = ethers.parseEther("1000000"); // 1M USD
      const collateral = ethers.parseEther("100000"); // 100K USD
      
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        maxSize,
        collateral,
        true,
        testConfig.DEFAULT_SLIPPAGE
      );
      
      expect(tx).to.not.be.reverted;
    });

    it("Should handle slippage protection", async function () {
      const { derivativesEngine, priceOracle, trader1 } = await loadFixture(deployDerivativesFixture);
      
      // Set very tight slippage tolerance
      const tightSlippage = 1; // 0.01%
      
      // Change price slightly
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2501"), 95);
      
      await testConfig.expectRevert(
        derivativesEngine.connect(trader1).openPosition(
          "ETH/USD",
          ethers.parseEther("10000"),
          ethers.parseEther("1000"),
          true,
          tightSlippage
        ),
        "Slippage too high"
      );
    });

    it("Should handle concurrent position operations", async function () {
      const { derivativesEngine, trader1, trader2 } = await loadFixture(deployDerivativesFixture);
      
      // Create positions concurrently
      const promises = [
        testConfig.createPosition(derivativesEngine, trader1, "ETH/USD", 5000, 500, true),
        testConfig.createPosition(derivativesEngine, trader2, "ETH/USD", 3000, 300, false),
      ];
      
      const results = await Promise.allSettled(promises);
      
      // Both should succeed
      expect(results[0].status).to.equal("fulfilled");
      expect(results[1].status).to.equal("fulfilled");
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should use reasonable gas for position operations", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      // Test gas usage for opening position
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        true,
        testConfig.DEFAULT_SLIPPAGE
      );
      
      const gasUsed = await testConfig.measureGasUsage(tx);
      expect(gasUsed).to.be.lte(testConfig.EXPECTED_GAS_USAGE.openPosition);
    });

    it("Should optimize gas for batch operations", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deployDerivativesFixture);
      
      // Create multiple positions and measure total gas
      const positions = [];
      let totalGas = 0n;
      
      for (let i = 0; i < 3; i++) {
        const tx = await derivativesEngine.connect(trader1).openPosition(
          "ETH/USD",
          ethers.parseEther("1000"),
          ethers.parseEther("100"),
          true,
          testConfig.DEFAULT_SLIPPAGE
        );
        
        const gasUsed = await testConfig.measureGasUsage(tx);
        totalGas += gasUsed;
      }
      
      // Average gas per position should be reasonable
      const avgGas = totalGas / 3n;
      expect(avgGas).to.be.lte(testConfig.EXPECTED_GAS_USAGE.openPosition);
    });
  });

  describe("Integration with Risk Manager", function () {
    it("Should respect risk manager position limits", async function () {
      const { derivativesEngine, riskManager, trader1 } = await loadFixture(deployDerivativesFixture);
      
      // Set low position limit
      await riskManager.setMaxPositionSize("ETH/USD", ethers.parseEther("5000"));
      
      await testConfig.expectRevert(
        derivativesEngine.connect(trader1).openPosition(
          "ETH/USD",
          ethers.parseEther("10000"), // Exceeds limit
          ethers.parseEther("1000"),
          true,
          testConfig.DEFAULT_SLIPPAGE
        ),
        "Position size too large"
      );
    });

    it("Should integrate with liquidation system", async function () {
      const { derivativesEngine, riskManager, priceOracle, trader1 } = await loadFixture(deployDerivativesFixture);
      
      // Create position close to liquidation
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        trader1,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      // Move price to trigger liquidation
      const liquidationPrice = testConfig.calculateLiquidationPrice(2500, 10, true);
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther(liquidationPrice.toString()), 95);
      
      // Check if position is liquidatable
      const isLiquidatable = await riskManager.isLiquidatable(positionId);
      expect(isLiquidatable).to.be.true;
    });
  });
});
