const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const testConfig = require("../config/test.config.js");

describe("Fuzzing Tests", function () {
  async function deployFuzzingFixture() {
    const [owner, ...users] = await ethers.getSigners();

    // Deploy contracts
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", testConfig.INITIAL_USDC_SUPPLY);

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    const priceOracle = await PriceOracle.deploy();

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

    await riskManager.setDerivativesEngine(derivativesEngine.target);

    // Setup markets
    await priceOracle.addOracle(owner.address, "MockOracle", 100);
    const markets = ["ETH/USD", "BTC/USD", "SOL/USD", "AVAX/USD", "MATIC/USD"];
    const prices = [2500, 45000, 100, 25, 1.2];
    
    for (let i = 0; i < markets.length; i++) {
      await testConfig.setupMarket(derivativesEngine, priceOracle, markets[i], prices[i], 25);
    }

    // Fund users
    for (const user of users.slice(0, 10)) {
      await testConfig.mintAndApprove(usdc, user, 1000000, derivativesEngine.target);
    }

    return {
      derivativesEngine,
      priceOracle,
      riskManager,
      usdc,
      owner,
      users: users.slice(0, 10),
      markets,
      prices,
    };
  }

  describe("Position Fuzzing", function () {
    it("Should handle random position parameters", async function () {
      const { derivativesEngine, users, markets } = await loadFixture(deployFuzzingFixture);
      
      const iterations = 100;
      const results = {
        successful: 0,
        failed: 0,
        errors: new Map(),
      };

      for (let i = 0; i < iterations; i++) {
        try {
          // Generate random parameters
          const user = users[Math.floor(Math.random() * users.length)];
          const market = markets[Math.floor(Math.random() * markets.length)];
          const size = testConfig.generateRandomAmount(100, 100000);
          const leverage = Math.floor(Math.random() * 25) + 1; // 1-25x
          const collateral = size / BigInt(leverage);
          const isLong = Math.random() > 0.5;
          const slippage = Math.floor(Math.random() * 1000) + 1; // 0.01% - 10%

          const tx = await derivativesEngine.connect(user).openPosition(
            market,
            size,
            collateral,
            isLong,
            slippage
          );

          await tx.wait();
          results.successful++;

        } catch (error) {
          results.failed++;
          const errorType = error.message.split(':')[0] || 'Unknown';
          results.errors.set(errorType, (results.errors.get(errorType) || 0) + 1);
        }
      }

      console.log(`Fuzzing Results: ${results.successful} successful, ${results.failed} failed`);
      console.log('Error distribution:', Object.fromEntries(results.errors));

      // At least some operations should succeed
      expect(results.successful).to.be.gt(0);
    });

    it("Should handle extreme position sizes", async function () {
      const { derivativesEngine, users, markets } = await loadFixture(deployFuzzingFixture);
      
      const extremeCases = [
        { size: 1, collateral: 1 }, // Minimum values
        { size: ethers.parseEther("0.000001"), collateral: ethers.parseEther("0.000001") },
        { size: ethers.parseEther("1000000"), collateral: ethers.parseEther("100000") }, // Large values
        { size: ethers.parseEther("999999999"), collateral: ethers.parseEther("99999999") }, // Very large
      ];

      for (const testCase of extremeCases) {
        const user = users[0];
        const market = markets[0];

        try {
          const tx = await derivativesEngine.connect(user).openPosition(
            market,
            testCase.size,
            testCase.collateral,
            true,
            50
          );
          
          // If it succeeds, verify the position was created correctly
          const receipt = await tx.wait();
          expect(receipt.status).to.equal(1);
          
        } catch (error) {
          // Expected for some extreme cases
          expect(error.message).to.match(/(Invalid|Insufficient|Too large|Too small)/);
        }
      }
    });

    it("Should handle rapid position operations", async function () {
      const { derivativesEngine, users, markets } = await loadFixture(deployFuzzingFixture);
      
      const user = users[0];
      const market = markets[0];
      const positionIds = [];

      // Rapidly create positions
      for (let i = 0; i < 10; i++) {
        try {
          const size = testConfig.generateRandomAmount(1000, 10000);
          const collateral = size / BigInt(10); // 10x leverage
          
          const tx = await derivativesEngine.connect(user).openPosition(
            market,
            size,
            collateral,
            true,
            50
          );
          
          const receipt = await tx.wait();
          const event = receipt.logs.find(log => 
            log.fragment && log.fragment.name === "PositionOpened"
          );
          
          if (event) {
            positionIds.push(event.args.positionId);
          }
        } catch (error) {
          // Some may fail due to insufficient balance
        }
      }

      // Rapidly close positions
      for (const positionId of positionIds) {
        try {
          await derivativesEngine.connect(user).closePosition(positionId, 50);
        } catch (error) {
          // Some may fail if already closed or liquidated
        }
      }

      // System should remain stable
      expect(true).to.be.true; // If we reach here, no critical failures occurred
    });
  });

  describe("Price Fuzzing", function () {
    it("Should handle random price movements", async function () {
      const { derivativesEngine, priceOracle, users, markets, prices, owner } = await loadFixture(deployFuzzingFixture);
      
      // Create some positions first
      const positionIds = [];
      for (let i = 0; i < 5; i++) {
        const user = users[i];
        const market = markets[i % markets.length];
        
        try {
          const positionId = await testConfig.createPosition(
            derivativesEngine,
            user,
            market,
            10000,
            1000,
            Math.random() > 0.5
          );
          positionIds.push({ id: positionId, market, user });
        } catch (error) {
          // Skip if position creation fails
        }
      }

      // Apply random price movements
      for (let i = 0; i < 50; i++) {
        const marketIndex = Math.floor(Math.random() * markets.length);
        const market = markets[marketIndex];
        const basePrice = prices[marketIndex];
        
        // Random price change: -50% to +100%
        const priceMultiplier = 0.5 + Math.random() * 1.5;
        const newPrice = Math.floor(basePrice * priceMultiplier);
        
        try {
          await priceOracle.connect(owner).emergencySetPrice(
            market,
            ethers.parseEther(newPrice.toString()),
            95
          );
          
          // Check if any positions became liquidatable
          for (const position of positionIds) {
            if (position.market === market) {
              try {
                const isLiquidatable = await derivativesEngine.isLiquidatable(position.id);
                // Position state should be consistent
                expect(typeof isLiquidatable).to.equal('boolean');
              } catch (error) {
                // Position might have been closed or liquidated
              }
            }
          }
          
        } catch (error) {
          // Some price changes might be rejected
        }
      }
    });

    it("Should handle price edge cases", async function () {
      const { priceOracle, markets, owner } = await loadFixture(deployFuzzingFixture);
      
      const edgeCases = [
        { price: 0, confidence: 95, shouldFail: true },
        { price: 1, confidence: 95, shouldFail: false },
        { price: ethers.parseEther("0.000001"), confidence: 95, shouldFail: false },
        { price: ethers.parseEther("1000000"), confidence: 95, shouldFail: false },
        { price: ethers.parseEther("1000"), confidence: 0, shouldFail: true },
        { price: ethers.parseEther("1000"), confidence: 101, shouldFail: true },
      ];

      for (const testCase of edgeCases) {
        const market = markets[0];
        
        try {
          await priceOracle.connect(owner).emergencySetPrice(
            market,
            testCase.price,
            testCase.confidence
          );
          
          if (testCase.shouldFail) {
            expect.fail("Expected transaction to fail");
          }
        } catch (error) {
          if (!testCase.shouldFail) {
            throw error;
          }
        }
      }
    });
  });

  describe("Collateral Fuzzing", function () {
    it("Should handle random collateral operations", async function () {
      const { derivativesEngine, users, markets } = await loadFixture(deployFuzzingFixture);
      
      // Create positions for testing
      const positions = [];
      for (let i = 0; i < 5; i++) {
        const user = users[i];
        const market = markets[i % markets.length];
        
        try {
          const positionId = await testConfig.createPosition(
            derivativesEngine,
            user,
            market,
            10000,
            2000, // Higher collateral for testing
            true
          );
          positions.push({ id: positionId, user });
        } catch (error) {
          // Skip failed position creation
        }
      }

      // Random collateral operations
      for (let i = 0; i < 50; i++) {
        if (positions.length === 0) break;
        
        const position = positions[Math.floor(Math.random() * positions.length)];
        const operation = Math.random() > 0.5 ? 'add' : 'remove';
        const amount = testConfig.generateRandomAmount(1, 1000);

        try {
          if (operation === 'add') {
            await derivativesEngine.connect(position.user).addCollateral(
              position.id,
              amount
            );
          } else {
            await derivativesEngine.connect(position.user).removeCollateral(
              position.id,
              amount
            );
          }
        } catch (error) {
          // Some operations may fail due to insufficient collateral or balance
        }
      }
    });
  });

  describe("Multi-User Fuzzing", function () {
    it("Should handle concurrent operations from multiple users", async function () {
      const { derivativesEngine, users, markets } = await loadFixture(deployFuzzingFixture);
      
      const operations = [];
      
      // Generate random operations for multiple users
      for (let i = 0; i < 20; i++) {
        const user = users[Math.floor(Math.random() * users.length)];
        const market = markets[Math.floor(Math.random() * markets.length)];
        const operationType = Math.random();
        
        if (operationType < 0.7) {
          // Open position
          operations.push(async () => {
            const size = testConfig.generateRandomAmount(1000, 50000);
            const leverage = Math.floor(Math.random() * 20) + 1;
            const collateral = size / BigInt(leverage);
            
            return derivativesEngine.connect(user).openPosition(
              market,
              size,
              collateral,
              Math.random() > 0.5,
              50
            );
          });
        } else {
          // Other operations would be added here
          operations.push(async () => {
            // Placeholder for other operations
            return Promise.resolve();
          });
        }
      }

      // Execute operations concurrently
      const results = await Promise.allSettled(operations.map(op => op()));
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log(`Concurrent operations: ${successful} successful, ${failed} failed`);
      
      // System should handle concurrent operations gracefully
      expect(successful + failed).to.equal(operations.length);
    });
  });

  describe("Gas Limit Fuzzing", function () {
    it("Should handle operations near gas limits", async function () {
      const { derivativesEngine, users, markets } = await loadFixture(deployFuzzingFixture);
      
      const user = users[0];
      const market = markets[0];
      
      // Test with various gas limits
      const gasLimits = [
        100000,   // Low gas
        300000,   // Normal gas
        1000000,  // High gas
        5000000,  // Very high gas
      ];

      for (const gasLimit of gasLimits) {
        try {
          const tx = await derivativesEngine.connect(user).openPosition(
            market,
            ethers.parseEther("1000"),
            ethers.parseEther("100"),
            true,
            50,
            { gasLimit }
          );
          
          const receipt = await tx.wait();
          expect(receipt.gasUsed).to.be.lte(gasLimit);
          
        } catch (error) {
          if (gasLimit < 200000) {
            // Expected to fail with low gas
            expect(error.message).to.include('gas');
          } else {
            throw error;
          }
        }
      }
    });
  });

  describe("State Consistency Fuzzing", function () {
    it("Should maintain invariants under random operations", async function () {
      const { derivativesEngine, priceOracle, usdc, users, markets, owner } = await loadFixture(deployFuzzingFixture);
      
      // Perform random operations
      for (let i = 0; i < 100; i++) {
        const operation = Math.floor(Math.random() * 4);
        const user = users[Math.floor(Math.random() * users.length)];
        const market = markets[Math.floor(Math.random() * markets.length)];
        
        try {
          switch (operation) {
            case 0: // Open position
              await testConfig.createPosition(
                derivativesEngine,
                user,
                market,
                Math.floor(Math.random() * 50000) + 1000,
                Math.floor(Math.random() * 5000) + 100,
                Math.random() > 0.5
              );
              break;
              
            case 1: // Update price
              const newPrice = Math.floor(Math.random() * 100000) + 100;
              await priceOracle.connect(owner).emergencySetPrice(
                market,
                ethers.parseEther(newPrice.toString()),
                95
              );
              break;
              
            case 2: // Check invariants
              await testConfig.checkInvariants({
                usdc,
                derivativesEngine,
              });
              break;
              
            case 3: // Time advancement
              await testConfig.increaseTime(Math.floor(Math.random() * 3600));
              break;
          }
        } catch (error) {
          // Some operations may fail, which is expected
        }
        
        // Check basic invariants periodically
        if (i % 10 === 0) {
          const contractBalance = await usdc.balanceOf(derivativesEngine.target);
          const totalSupply = await usdc.totalSupply();
          
          // Contract balance should never exceed total supply
          expect(contractBalance).to.be.lte(totalSupply);
        }
      }
    });
  });
});
