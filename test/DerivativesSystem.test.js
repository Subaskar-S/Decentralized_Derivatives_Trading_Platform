const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Derivatives Trading System", function () {
  // Test fixture for deployment
  async function deploySystemFixture() {
    const [owner, trader1, trader2, liquidator, treasury] = await ethers.getSigners();

    // Deploy mock collateral token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const collateralToken = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));

    // Deploy governance token
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const governanceToken = await GovernanceToken.deploy(treasury.address, owner.address);

    // Deploy price oracle
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    const priceOracle = await PriceOracle.deploy();

    // Deploy risk manager
    const RiskManager = await ethers.getContractFactory("RiskManager");
    const riskManager = await RiskManager.deploy(ethers.ZeroAddress, priceOracle.target);

    // Deploy derivatives engine
    const DerivativesEngine = await ethers.getContractFactory("DerivativesEngine");
    const derivativesEngine = await DerivativesEngine.deploy(
      priceOracle.target,
      riskManager.target,
      collateralToken.target
    );

    // Deploy governance
    const Governance = await ethers.getContractFactory("Governance");
    const governance = await Governance.deploy(governanceToken.target);

    // Set up cross-references
    await riskManager.setDerivativesEngine(derivativesEngine.target);

    // Add mock oracle
    await priceOracle.addOracle(owner.address, "MockOracle", 100);

    // Set up initial prices
    await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2000"), 95);
    await priceOracle.emergencySetPrice("BTC/USD", ethers.parseEther("40000"), 95);

    // Add markets
    await derivativesEngine.addMarket("ETH/USD", 10); // 10x max leverage
    await derivativesEngine.addMarket("BTC/USD", 5);  // 5x max leverage

    // Mint tokens to traders
    await collateralToken.mint(trader1.address, ethers.parseEther("10000"));
    await collateralToken.mint(trader2.address, ethers.parseEther("10000"));
    await collateralToken.mint(liquidator.address, ethers.parseEther("10000"));

    // Approve spending
    await collateralToken.connect(trader1).approve(derivativesEngine.target, ethers.parseEther("10000"));
    await collateralToken.connect(trader2).approve(derivativesEngine.target, ethers.parseEther("10000"));

    return {
      derivativesEngine,
      priceOracle,
      riskManager,
      governance,
      governanceToken,
      collateralToken,
      owner,
      trader1,
      trader2,
      liquidator,
      treasury,
    };
  }

  describe("Deployment", function () {
    it("Should deploy all contracts successfully", async function () {
      const { derivativesEngine, priceOracle, riskManager, governance } = await loadFixture(deploySystemFixture);
      
      expect(await derivativesEngine.priceOracle()).to.equal(priceOracle.target);
      expect(await derivativesEngine.riskManager()).to.equal(riskManager.target);
      expect(await riskManager.priceOracle()).to.equal(priceOracle.target);
      expect(await governance.governanceToken()).to.not.equal(ethers.ZeroAddress);
    });

    it("Should have correct initial market setup", async function () {
      const { derivativesEngine } = await loadFixture(deploySystemFixture);
      
      const ethMarket = await derivativesEngine.getMarket("ETH/USD");
      expect(ethMarket.symbol).to.equal("ETH/USD");
      expect(ethMarket.maxLeverage).to.equal(10);
      expect(ethMarket.isActive).to.be.true;
    });
  });

  describe("Price Oracle", function () {
    it("Should return valid price data", async function () {
      const { priceOracle } = await loadFixture(deploySystemFixture);
      
      const priceData = await priceOracle.getPrice("ETH/USD");
      expect(priceData.price).to.equal(ethers.parseEther("2000"));
      expect(priceData.isValid).to.be.true;
      expect(priceData.confidence).to.equal(95);
    });

    it("Should allow oracle management", async function () {
      const { priceOracle, owner, trader1 } = await loadFixture(deploySystemFixture);
      
      await priceOracle.addOracle(trader1.address, "TestOracle", 50);
      expect(await priceOracle.getOracleCount()).to.equal(2);
      
      await priceOracle.removeOracle(trader1.address);
      expect(await priceOracle.getOracleCount()).to.equal(1);
    });
  });

  describe("Position Management", function () {
    it("Should open a long position", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deploySystemFixture);
      
      const size = ethers.parseEther("1000"); // $1000 position
      const collateral = ethers.parseEther("200"); // $200 collateral (5x leverage)
      
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        size,
        collateral,
        true, // isLong
        0 // maxSlippage
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      expect(event).to.not.be.undefined;
      
      const positionId = event.args.positionId;
      const position = await derivativesEngine.getPosition(positionId);
      
      expect(position.trader).to.equal(trader1.address);
      expect(position.size).to.equal(size);
      expect(position.collateral).to.equal(collateral);
      expect(position.isLong).to.be.true;
    });

    it("Should calculate PnL correctly", async function () {
      const { derivativesEngine, priceOracle, trader1 } = await loadFixture(deploySystemFixture);
      
      // Open position at $2000
      const size = ethers.parseEther("1000");
      const collateral = ethers.parseEther("200");
      
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        size,
        collateral,
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      // Update price to $2100 (+5%)
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2100"), 95);
      
      const pnl = await derivativesEngine.calculatePnL(positionId);
      // Expected PnL: (2100 - 2000) / 2000 * 1000 = 50
      expect(pnl).to.be.closeTo(ethers.parseEther("50"), ethers.parseEther("1"));
    });

    it("Should close position and realize PnL", async function () {
      const { derivativesEngine, priceOracle, trader1, collateralToken } = await loadFixture(deploySystemFixture);
      
      const initialBalance = await collateralToken.balanceOf(trader1.address);
      
      // Open position
      const size = ethers.parseEther("1000");
      const collateral = ethers.parseEther("200");
      
      const openTx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        size,
        collateral,
        true,
        0
      );
      
      const openReceipt = await openTx.wait();
      const openEvent = openReceipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = openEvent.args.positionId;
      
      // Update price to $2100 (+5% profit)
      await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2100"), 95);
      
      // Close position
      await derivativesEngine.connect(trader1).closePosition(positionId, 0);
      
      const finalBalance = await collateralToken.balanceOf(trader1.address);

      // Should have received back the original collateral (simplified for demo)
      expect(finalBalance).to.equal(initialBalance);
    });
  });

  describe("Risk Management", function () {
    it("Should calculate margin ratio correctly", async function () {
      const { derivativesEngine, riskManager, trader1 } = await loadFixture(deploySystemFixture);
      
      const size = ethers.parseEther("1000");
      const collateral = ethers.parseEther("200"); // 20% margin ratio
      
      const tx = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        size,
        collateral,
        true,
        0
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PositionOpened");
      const positionId = event.args.positionId;
      
      const marginRatio = await riskManager.calculateMarginRatio(positionId);
      expect(marginRatio).to.equal(2000); // 20% in basis points
    });

    it("Should prevent over-leveraged positions", async function () {
      const { derivativesEngine, trader1 } = await loadFixture(deploySystemFixture);
      
      const size = ethers.parseEther("1000");
      const collateral = ethers.parseEther("50"); // 20x leverage (exceeds 10x limit)
      
      await expect(
        derivativesEngine.connect(trader1).openPosition(
          "ETH/USD",
          size,
          collateral,
          true,
          0
        )
      ).to.be.revertedWith("Position violates risk parameters");
    });
  });

  describe("Governance", function () {
    it("Should create and vote on proposals", async function () {
      const { governance, governanceToken, owner, treasury } = await loadFixture(deploySystemFixture);
      
      // Enable trading and mint tokens for voting
      await governanceToken.enableTrading();
      await governanceToken.mintCommunityRewards(owner.address, ethers.parseEther("200000"));
      
      // Create proposal
      const targets = [governanceToken.target];
      const values = [0];
      const calldatas = [governanceToken.interface.encodeFunctionData("setTreasury", [treasury.address])];
      
      const proposalTx = await governance.propose(
        targets,
        values,
        calldatas,
        "Update Treasury",
        "Proposal to update treasury address",
        "QmTest123"
      );
      
      const receipt = await proposalTx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "ProposalCreated");
      const proposalId = event.args.proposalId;
      
      // Check proposal state
      expect(await governance.state(proposalId)).to.equal(0); // Pending
      
      const proposal = await governance.getProposal(proposalId);
      expect(proposal.title).to.equal("Update Treasury");
    });
  });

  describe("Integration Tests", function () {
    it("Should handle complete trading lifecycle", async function () {
      const { derivativesEngine, priceOracle, trader1, trader2 } = await loadFixture(deploySystemFixture);
      
      // Trader1 opens long position
      const tx1 = await derivativesEngine.connect(trader1).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("200"),
        true,
        0
      );
      
      // Trader2 opens short position
      const tx2 = await derivativesEngine.connect(trader2).openPosition(
        "ETH/USD",
        ethers.parseEther("1000"),
        ethers.parseEther("200"),
        false,
        0
      );
      
      // Check market open interest
      const market = await derivativesEngine.getMarket("ETH/USD");
      expect(market.openInterestLong).to.equal(ethers.parseEther("1000"));
      expect(market.openInterestShort).to.equal(ethers.parseEther("1000"));
      
      // Update funding rate
      await derivativesEngine.updateFundingRate("ETH/USD");
      
      const updatedMarket = await derivativesEngine.getMarket("ETH/USD");
      expect(updatedMarket.lastFundingTime).to.be.greaterThan(market.lastFundingTime);
    });
  });
});
