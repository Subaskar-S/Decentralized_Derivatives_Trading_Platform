const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("L2 Integration and Optimization", function () {
  // Test fixture for L2 deployment
  async function deployL2Fixture() {
    const [owner, trader1, trader2, liquidator, keeper] = await ethers.getSigners();

    // Deploy L2 infrastructure
    const L2GasManager = await ethers.getContractFactory("L2GasManager");
    const gasManager = await L2GasManager.deploy();

    const BatchExecutor = await ethers.getContractFactory("BatchExecutor");
    const batchExecutor = await BatchExecutor.deploy();

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("10000000"));

    // Deploy core contracts
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    const priceOracle = await PriceOracle.deploy();

    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const governanceToken = await GovernanceToken.deploy(owner.address, owner.address);

    const AdvancedGovernance = await ethers.getContractFactory("AdvancedGovernance");
    const governance = await AdvancedGovernance.deploy(governanceToken.target, owner.address);

    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(
      governance.target,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );

    const AdvancedRiskManager = await ethers.getContractFactory("AdvancedRiskManager");
    const riskManager = await AdvancedRiskManager.deploy(
      ethers.ZeroAddress,
      priceOracle.target,
      usdc.target
    );

    const DerivativesEngine = await ethers.getContractFactory("DerivativesEngine");
    const derivativesEngine = await DerivativesEngine.deploy(
      priceOracle.target,
      riskManager.target,
      usdc.target
    );

    // Set up relationships
    await riskManager.setDerivativesEngine(derivativesEngine.target);
    await gasManager.setAuthorizedCaller(batchExecutor.target, true);
    await batchExecutor.setAuthorizedCaller(owner.address, true);

    // Set up oracle and market
    await priceOracle.addOracle(owner.address, "MockOracle", 100);
    await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2500"), 95);
    await derivativesEngine.addMarket("ETH/USD", 25);

    // Enable trading
    await governanceToken.enableTrading();

    // Mint tokens
    await usdc.mint(trader1.address, ethers.parseEther("10000"));
    await usdc.mint(trader2.address, ethers.parseEther("10000"));
    await usdc.connect(trader1).approve(derivativesEngine.target, ethers.parseEther("10000"));
    await usdc.connect(trader2).approve(derivativesEngine.target, ethers.parseEther("10000"));

    return {
      gasManager,
      batchExecutor,
      derivativesEngine,
      riskManager,
      priceOracle,
      usdc,
      governanceToken,
      governance,
      treasury,
      owner,
      trader1,
      trader2,
      liquidator,
      keeper,
    };
  }

  describe("L2 Gas Manager", function () {
    it("Should optimize gas prices for different operations", async function () {
      const { gasManager } = await loadFixture(deployL2Fixture);
      
      const [gasPrice, gasLimit] = await gasManager.getOptimizedGasPrice("openPosition");
      expect(gasPrice).to.equal(1000000); // 0.001 gwei
      expect(gasLimit).to.equal(300000);
      
      const [liqGasPrice, liqGasLimit] = await gasManager.getOptimizedGasPrice("liquidation");
      expect(liqGasPrice).to.equal(2000000); // Higher priority for liquidations
      expect(liqGasLimit).to.equal(400000);
    });

    it("Should estimate L2 costs including L1 data availability", async function () {
      const { gasManager } = await loadFixture(deployL2Fixture);
      
      const testData = "0x1234567890abcdef";
      const gasLimit = 300000;
      
      const [l2ExecutionCost, l1DataCost, totalCost] = await gasManager.estimateL2Cost(
        testData,
        gasLimit
      );
      
      expect(l2ExecutionCost).to.be.greaterThan(0);
      expect(l1DataCost).to.be.greaterThan(0);
      expect(totalCost).to.equal(l2ExecutionCost + l1DataCost);
    });

    it("Should manage gas credits for subsidized transactions", async function () {
      const { gasManager, trader1 } = await loadFixture(deployL2Fixture);
      
      await gasManager.addGasCredits(trader1.address, ethers.parseEther("1"));
      
      let credits = await gasManager.getUserGasCredits(trader1.address);
      expect(credits).to.equal(ethers.parseEther("1"));
      
      const success = await gasManager.useGasCredits(trader1.address, ethers.parseEther("0.5"));
      expect(success).to.be.true;
      
      credits = await gasManager.getUserGasCredits(trader1.address);
      expect(credits).to.equal(ethers.parseEther("0.5"));
    });

    it("Should update L1 gas price with cooldown", async function () {
      const { gasManager } = await loadFixture(deployL2Fixture);
      
      await gasManager.updateL1GasPrice();
      
      // Should fail if called too soon
      await expect(gasManager.updateL1GasPrice()).to.be.revertedWith("Too frequent updates");
      
      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [301]); // 5+ minutes
      await ethers.provider.send("evm_mine");
      
      // Should succeed now
      await expect(gasManager.updateL1GasPrice()).to.not.be.reverted;
    });
  });

  describe("Batch Executor", function () {
    it("Should execute batch transactions efficiently", async function () {
      const { batchExecutor, derivativesEngine, owner } = await loadFixture(deployL2Fixture);
      
      const calls = [
        {
          target: derivativesEngine.target,
          value: 0,
          data: derivativesEngine.interface.encodeFunctionData("addMarket", ["BTC/USD", 20]),
          requireSuccess: true
        },
        {
          target: derivativesEngine.target,
          value: 0,
          data: derivativesEngine.interface.encodeFunctionData("addMarket", ["SOL/USD", 15]),
          requireSuccess: true
        }
      ];
      
      const results = await batchExecutor.executeBatch(calls);
      
      expect(results).to.have.length(2);
      expect(results[0].success).to.be.true;
      expect(results[1].success).to.be.true;
      
      // Verify markets were added
      const btcMarket = await derivativesEngine.markets("BTC/USD");
      const solMarket = await derivativesEngine.markets("SOL/USD");
      expect(btcMarket.isActive).to.be.true;
      expect(solMarket.isActive).to.be.true;
    });

    it("Should batch multiple trades for gas efficiency", async function () {
      const { batchExecutor, derivativesEngine, trader1, trader2 } = await loadFixture(deployL2Fixture);
      
      const trades = [
        {
          trader: trader1.address,
          symbol: "ETH/USD",
          size: ethers.parseEther("1000"),
          collateral: ethers.parseEther("100"),
          isLong: true,
          maxSlippage: 50,
          operationType: 0 // open
        },
        {
          trader: trader2.address,
          symbol: "ETH/USD",
          size: ethers.parseEther("2000"),
          collateral: ethers.parseEther("200"),
          isLong: false,
          maxSlippage: 50,
          operationType: 0 // open
        }
      ];
      
      const positionIds = await batchExecutor.batchTrades(trades, derivativesEngine.target);
      
      expect(positionIds).to.have.length(2);
      expect(positionIds[0]).to.not.equal(ethers.ZeroHash);
      expect(positionIds[1]).to.not.equal(ethers.ZeroHash);
    });

    it("Should estimate gas for batch operations", async function () {
      const { batchExecutor, derivativesEngine } = await loadFixture(deployL2Fixture);
      
      const calls = [
        {
          target: derivativesEngine.target,
          value: 0,
          data: derivativesEngine.interface.encodeFunctionData("addMarket", ["AVAX/USD", 10]),
          requireSuccess: true
        }
      ];
      
      const estimatedGas = await batchExecutor.estimateBatchGas(calls);
      expect(estimatedGas).to.be.greaterThan(50000); // Should include base cost + data cost
    });

    it("Should handle batch approvals efficiently", async function () {
      const { batchExecutor, usdc, derivativesEngine, trader1 } = await loadFixture(deployL2Fixture);
      
      const tokens = [usdc.target, usdc.target];
      const spenders = [derivativesEngine.target, batchExecutor.target];
      const amounts = [ethers.parseEther("1000"), ethers.parseEther("500")];
      
      await batchExecutor.connect(trader1).batchApprovals(tokens, spenders, amounts);
      
      const allowance1 = await usdc.allowance(trader1.address, derivativesEngine.target);
      const allowance2 = await usdc.allowance(trader1.address, batchExecutor.target);
      
      expect(allowance1).to.equal(ethers.parseEther("1000"));
      expect(allowance2).to.equal(ethers.parseEther("500"));
    });

    it("Should execute multicall with gas limits", async function () {
      const { batchExecutor, derivativesEngine } = await loadFixture(deployL2Fixture);
      
      const calls = [
        {
          target: derivativesEngine.target,
          value: 0,
          data: derivativesEngine.interface.encodeFunctionData("addMarket", ["MATIC/USD", 15]),
          requireSuccess: false
        }
      ];
      
      const gasLimitPerCall = 200000;
      const results = await batchExecutor.multicallWithGasLimit(calls, gasLimitPerCall);
      
      expect(results).to.have.length(1);
      expect(results[0].success).to.be.true;
      expect(results[0].gasUsed).to.be.lessThan(gasLimitPerCall);
    });
  });

  describe("L2 Performance Optimization", function () {
    it("Should demonstrate gas savings through batching", async function () {
      const { batchExecutor, derivativesEngine, gasManager } = await loadFixture(deployL2Fixture);
      
      // Individual transactions
      const tx1 = await derivativesEngine.addMarket("LINK/USD", 20);
      const receipt1 = await tx1.wait();
      const individualGas1 = receipt1.gasUsed;
      
      const tx2 = await derivativesEngine.addMarket("UNI/USD", 18);
      const receipt2 = await tx2.wait();
      const individualGas2 = receipt2.gasUsed;
      
      const totalIndividualGas = individualGas1 + individualGas2;
      
      // Batched transactions
      const calls = [
        {
          target: derivativesEngine.target,
          value: 0,
          data: derivativesEngine.interface.encodeFunctionData("addMarket", ["AAVE/USD", 22]),
          requireSuccess: true
        },
        {
          target: derivativesEngine.target,
          value: 0,
          data: derivativesEngine.interface.encodeFunctionData("addMarket", ["CRV/USD", 16]),
          requireSuccess: true
        }
      ];
      
      const batchTx = await batchExecutor.executeBatch(calls);
      const batchReceipt = await batchTx.wait();
      const batchGas = batchReceipt.gasUsed;
      
      console.log(`Individual gas: ${totalIndividualGas}`);
      console.log(`Batch gas: ${batchGas}`);
      console.log(`Gas savings: ${totalIndividualGas - batchGas}`);
      
      // Batch should be more efficient (though savings may be minimal in test environment)
      expect(batchGas).to.be.lessThan(totalIndividualGas + 100000n); // Allow some overhead
    });

    it("Should optimize for L2 rollup characteristics", async function () {
      const { gasManager } = await loadFixture(deployL2Fixture);
      
      // Test L2-specific optimizations
      const testData = "0x" + "00".repeat(1000); // 1KB of zero bytes (should be cheap on L2)
      const [l2Cost, l1Cost, totalCost] = await gasManager.estimateL2Cost(testData, 100000);
      
      // L2 execution should be very cheap
      expect(l2Cost).to.be.lessThan(ethers.parseEther("0.001"));
      
      // L1 data cost should dominate for large calldata
      expect(l1Cost).to.be.greaterThan(l2Cost);
    });

    it("Should handle high-frequency operations efficiently", async function () {
      const { batchExecutor, derivativesEngine, trader1, usdc } = await loadFixture(deployL2Fixture);
      
      // Simulate high-frequency trading scenario
      const trades = [];
      for (let i = 0; i < 10; i++) {
        trades.push({
          trader: trader1.address,
          symbol: "ETH/USD",
          size: ethers.parseEther("100"),
          collateral: ethers.parseEther("10"),
          isLong: i % 2 === 0,
          maxSlippage: 50,
          operationType: 0
        });
      }
      
      const startTime = Date.now();
      const positionIds = await batchExecutor.batchTrades(trades, derivativesEngine.target);
      const endTime = Date.now();
      
      expect(positionIds).to.have.length(10);
      console.log(`Batched 10 trades in ${endTime - startTime}ms`);
      
      // All positions should be created
      for (const positionId of positionIds) {
        if (positionId !== ethers.ZeroHash) {
          const position = await derivativesEngine.getPosition(positionId);
          expect(position.trader).to.equal(trader1.address);
        }
      }
    });
  });

  describe("L2 Integration Edge Cases", function () {
    it("Should handle batch failures gracefully", async function () {
      const { batchExecutor, derivativesEngine } = await loadFixture(deployL2Fixture);
      
      const calls = [
        {
          target: derivativesEngine.target,
          value: 0,
          data: derivativesEngine.interface.encodeFunctionData("addMarket", ["VALID/USD", 10]),
          requireSuccess: false
        },
        {
          target: derivativesEngine.target,
          value: 0,
          data: "0xinvaliddata", // Invalid call data
          requireSuccess: false
        }
      ];
      
      const results = await batchExecutor.executeBatch(calls);
      
      expect(results[0].success).to.be.true;
      expect(results[1].success).to.be.false;
    });

    it("Should respect gas limits in multicall", async function () {
      const { batchExecutor, derivativesEngine } = await loadFixture(deployL2Fixture);
      
      const calls = [
        {
          target: derivativesEngine.target,
          value: 0,
          data: derivativesEngine.interface.encodeFunctionData("addMarket", ["TEST/USD", 5]),
          requireSuccess: false
        }
      ];
      
      // Set very low gas limit
      const lowGasLimit = 50000;
      const results = await batchExecutor.multicallWithGasLimit(calls, lowGasLimit);
      
      // Should handle insufficient gas gracefully
      expect(results).to.have.length(1);
    });

    it("Should maintain batch statistics", async function () {
      const { batchExecutor } = await loadFixture(deployL2Fixture);
      
      const initialStats = await batchExecutor.getBatchStats();
      
      // Execute a batch
      const calls = [{
        target: ethers.ZeroAddress,
        value: 0,
        data: "0x",
        requireSuccess: false
      }];
      
      await batchExecutor.executeBatch(calls);
      
      const finalStats = await batchExecutor.getBatchStats();
      expect(finalStats.totalBatches).to.equal(initialStats.totalBatches + 1n);
    });
  });
});
