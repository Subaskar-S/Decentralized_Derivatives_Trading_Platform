const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Risk Management System", function () {
  // Test fixture for risk management deployment
  async function deployRiskManagementFixture() {
    const [owner, trader1, trader2, liquidator1, liquidator2, keeper] = await ethers.getSigners();

    // Deploy mock collateral token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("10000000"));

    // Deploy mock price oracle
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    const priceOracle = await PriceOracle.deploy();

    // Deploy advanced risk manager
    const AdvancedRiskManager = await ethers.getContractFactory("AdvancedRiskManager");
    const riskManager = await AdvancedRiskManager.deploy(
      ethers.ZeroAddress, // Will set derivatives engine later
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

    // Deploy liquidation bot
    const LiquidationBot = await ethers.getContractFactory("LiquidationBot");
    const liquidationBot = await LiquidationBot.deploy(
      riskManager.target,
      derivativesEngine.target,
      priceOracle.target,
      usdc.target
    );

    // Deploy insurance fund
    const InsuranceFund = await ethers.getContractFactory("InsuranceFund");
    const insuranceFund = await InsuranceFund.deploy(
      usdc.target,
      riskManager.target,
      derivativesEngine.target
    );

    // Set up cross-references
    await riskManager.setDerivativesEngine(derivativesEngine.target);

    // Add mock oracle and set prices
    await priceOracle.addOracle(owner.address, "MockOracle", 100);
    await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2000"), 95);

    // Add market
    await derivativesEngine.addMarket("ETH/USD", 10);

    // Mint tokens to users
    await usdc.mint(trader1.address, ethers.parseEther("10000"));
    await usdc.mint(trader2.address, ethers.parseEther("10000"));
    await usdc.mint(liquidator1.address, ethers.parseEther("5000"));
    await usdc.mint(liquidator2.address, ethers.parseEther("5000"));
    await usdc.mint(keeper.address, ethers.parseEther("1000"));

    // Approve spending
    await usdc.connect(trader1).approve(derivativesEngine.target, ethers.parseEther("10000"));
    await usdc.connect(trader2).approve(derivativesEngine.target, ethers.parseEther("10000"));
    await usdc.connect(keeper).approve(insuranceFund.target, ethers.parseEther("1000"));

    return {
      riskManager,
      derivativesEngine,
      liquidationBot,
      insuranceFund,
      priceOracle,
      usdc,
      owner,
      trader1,
      trader2,
      liquidator1,
      liquidator2,
      keeper,
    };
  }

  describe("Advanced Risk Manager", function () {
    it("Should register liquidators", async function () {
      const { riskManager, liquidator1 } = await loadFixture(deployRiskManagementFixture);
      
      await riskManager.connect(liquidator1).registerLiquidator();
      
      const liquidatorInfo = await riskManager.liquidators(liquidator1.address);
      expect(liquidatorInfo.isActive).to.be.true;
      expect(liquidatorInfo.successRate).to.equal(10000); // 100%
    });

    it("Should calculate enhanced margin ratios", async function () {
      const { riskManager, derivativesEngine, trader1 } = await loadFixture(deployRiskManagementFixture);
      
      // Open a position
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"), // $1000 position
        ethers.parseEther("200"),   // $200 collateral (5x leverage)
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      const marginRatio = await riskManager.calculateMarginRatio(positionId);
      expect(marginRatio).to.equal(2000); // 20% margin ratio
    });

    it("Should handle partial liquidations", async function () {
      const { riskManager, derivativesEngine, priceOracle, trader1, liquidator1 } = 
        await loadFixture(deployRiskManagementFixture);
      
      // Register liquidator
      await riskManager.connect(liquidator1).registerLiquidator();
      
      // Open position
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("100"), // 10x leverage
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      // Drop price to trigger partial liquidation zone
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("1900"), 95); // -5%
      
      // Check if liquidation is possible
      const canLiquidate = await riskManager.checkLiquidation(positionId);
      expect(canLiquidate).to.be.true;
      
      // Execute liquidation
      await riskManager.connect(liquidator1).liquidate(positionId);
      
      const liquidatorInfo = await riskManager.liquidators(liquidator1.address);
      expect(liquidatorInfo.totalLiquidations).to.equal(1);
    });

    it("Should update trader risk scores", async function () {
      const { riskManager, derivativesEngine, priceOracle, trader1, liquidator1 } = 
        await loadFixture(deployRiskManagementFixture);
      
      // Register liquidator
      await riskManager.connect(liquidator1).registerLiquidator();
      
      // Open position that will be liquidated
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("60"), // High leverage
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      // Drop price significantly
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("1800"), 95);
      
      // Execute liquidation
      await riskManager.connect(liquidator1).liquidate(positionId);
      
      // Check risk score increased
      const riskScore = await riskManager.traderRiskScore(trader1.address);
      expect(riskScore).to.be.greaterThan(0);
    });

    it("Should manage insurance fund contributions", async function () {
      const { riskManager, derivativesEngine, trader1, liquidator1 } = 
        await loadFixture(deployRiskManagementFixture);
      
      // Register liquidator
      await riskManager.connect(liquidator1).registerLiquidator();
      
      // Open and liquidate position to generate insurance contribution
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("60"),
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      const initialFunds = await riskManager.insuranceFund();
      
      // Liquidate position
      await riskManager.connect(liquidator1).liquidate(positionId);
      
      const finalFunds = await riskManager.insuranceFund();
      expect(finalFunds.totalFunds).to.be.greaterThan(initialFunds.totalFunds);
    });
  });

  describe("Liquidation Bot", function () {
    it("Should register keepers", async function () {
      const { liquidationBot, keeper } = await loadFixture(deployRiskManagementFixture);
      
      await liquidationBot.connect(keeper).registerKeeper();
      
      const keeperInfo = await liquidationBot.keepers(keeper.address);
      expect(keeperInfo.isActive).to.be.true;
    });

    it("Should add liquidation targets", async function () {
      const { liquidationBot, derivativesEngine, trader1 } = 
        await loadFixture(deployRiskManagementFixture);
      
      // Open position
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("100"),
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      // Add to liquidation targets
      await liquidationBot.addLiquidationTarget(positionId);
      
      const target = await liquidationBot.liquidationTargets(positionId);
      expect(target.isActive).to.be.true;
      expect(target.positionId).to.equal(positionId);
    });

    it("Should update liquidation targets", async function () {
      const { liquidationBot, derivativesEngine, trader1, keeper } = 
        await loadFixture(deployRiskManagementFixture);
      
      // Register keeper
      await liquidationBot.connect(keeper).registerKeeper();
      
      // Open position and add to targets
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("100"),
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      await liquidationBot.addLiquidationTarget(positionId);
      
      // Fast forward time to allow updates
      await ethers.provider.send("evm_increaseTime", [301]); // 5+ minutes
      
      // Update targets
      await liquidationBot.connect(keeper).updateLiquidationTargets();
      
      const keeperInfo = await liquidationBot.keepers(keeper.address);
      expect(keeperInfo.gasUsed).to.be.greaterThan(0);
    });

    it("Should get high priority targets", async function () {
      const { liquidationBot, derivativesEngine, priceOracle, trader1 } = 
        await loadFixture(deployRiskManagementFixture);
      
      // Open high-risk position
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("60"), // High leverage
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      await liquidationBot.addLiquidationTarget(positionId);
      
      // Drop price to make it high priority
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("1900"), 95);
      
      const highPriorityTargets = await liquidationBot.getHighPriorityTargets();
      expect(highPriorityTargets.length).to.be.greaterThan(0);
    });
  });

  describe("Insurance Fund", function () {
    it("Should accept contributions", async function () {
      const { insuranceFund, usdc, keeper } = await loadFixture(deployRiskManagementFixture);
      
      const contributionAmount = ethers.parseEther("500");
      
      await insuranceFund.connect(keeper).contribute(contributionAmount);
      
      const fundMetrics = await insuranceFund.fundMetrics();
      expect(fundMetrics.currentBalance).to.equal(contributionAmount);
      
      const contributorInfo = await insuranceFund.getContributorInfo(keeper.address);
      expect(contributorInfo.totalContributed).to.equal(contributionAmount);
    });

    it("Should handle claim submissions", async function () {
      const { insuranceFund, riskManager } = await loadFixture(deployRiskManagementFixture);
      
      // Submit claim from authorized claimant (risk manager)
      const claimAmount = ethers.parseEther("100");
      const reason = "Bad debt from liquidation";
      
      const claimId = await insuranceFund.connect(riskManager.target).submitClaim.staticCall(
        claimAmount,
        reason,
        "0x"
      );
      
      await insuranceFund.connect(riskManager.target).submitClaim(
        claimAmount,
        reason,
        "0x"
      );
      
      const claimDetails = await insuranceFund.getClaimDetails(claimId);
      expect(claimDetails.amount).to.equal(claimAmount);
      expect(claimDetails.reason).to.equal(reason);
    });

    it("Should approve and pay claims", async function () {
      const { insuranceFund, usdc, keeper, owner } = await loadFixture(deployRiskManagementFixture);
      
      // First contribute to fund
      const contributionAmount = ethers.parseEther("500");
      await insuranceFund.connect(keeper).contribute(contributionAmount);
      
      // Submit claim
      const claimAmount = ethers.parseEther("100");
      const claimId = await insuranceFund.submitClaim.staticCall(
        claimAmount,
        "Test claim",
        "0x"
      );
      
      await insuranceFund.submitClaim(claimAmount, "Test claim", "0x");
      
      // Approve claim
      await insuranceFund.connect(owner).approveClaim(claimId);
      
      // Pay claim
      const initialBalance = await usdc.balanceOf(owner.address);
      await insuranceFund.payClaim(claimId);
      const finalBalance = await usdc.balanceOf(owner.address);
      
      expect(finalBalance - initialBalance).to.equal(claimAmount);
    });

    it("Should calculate fund health", async function () {
      const { insuranceFund, keeper } = await loadFixture(deployRiskManagementFixture);
      
      // Contribute to fund
      await insuranceFund.connect(keeper).contribute(ethers.parseEther("500"));
      
      const fundHealth = await insuranceFund.getFundHealth();
      expect(fundHealth.currentBalance).to.equal(ethers.parseEther("500"));
      expect(fundHealth.reserveRatio).to.be.greaterThan(0);
    });
  });

  describe("Integration Tests", function () {
    it("Should handle complete liquidation workflow", async function () {
      const { 
        riskManager, 
        derivativesEngine, 
        liquidationBot, 
        insuranceFund, 
        priceOracle, 
        trader1, 
        liquidator1, 
        keeper 
      } = await loadFixture(deployRiskManagementFixture);
      
      // Setup: Register liquidator and keeper, contribute to insurance fund
      await riskManager.connect(liquidator1).registerLiquidator();
      await liquidationBot.connect(keeper).registerKeeper();
      await insuranceFund.connect(keeper).contribute(ethers.parseEther("500"));
      
      // Open risky position
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("60"), // High leverage
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      // Add to liquidation monitoring
      await liquidationBot.addLiquidationTarget(positionId);
      
      // Price drops, triggering liquidation
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("1800"), 95);
      
      // Verify position is liquidatable
      const canLiquidate = await riskManager.checkLiquidation(positionId);
      expect(canLiquidate).to.be.true;
      
      // Execute liquidation
      const liquidationReward = await riskManager.connect(liquidator1).liquidate(positionId);
      
      // Verify liquidation was successful
      const liquidatorInfo = await riskManager.liquidators(liquidator1.address);
      expect(liquidatorInfo.totalLiquidations).to.equal(1);
      
      // Verify insurance fund received contribution
      const fundMetrics = await insuranceFund.fundMetrics();
      expect(fundMetrics.totalFunds).to.be.greaterThan(ethers.parseEther("500"));
    });
  });
});
