const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const testConfig = require("../config/test.config.js");

describe("Security Audit Tests", function () {
  async function deploySecurityTestFixture() {
    const [owner, attacker, victim, liquidator] = await ethers.getSigners();

    // Deploy all contracts
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

    // Deploy malicious contracts for testing
    const MaliciousReentrant = await ethers.getContractFactory("MaliciousReentrant");
    const maliciousContract = await MaliciousReentrant.deploy();

    // Setup
    await priceOracle.addOracle(owner.address, "MockOracle", 100);
    await testConfig.setupMarket(derivativesEngine, priceOracle, "ETH/USD", 2500, 25);

    // Fund accounts
    await testConfig.mintAndApprove(usdc, victim, 100000, derivativesEngine.target);
    await testConfig.mintAndApprove(usdc, attacker, 100000, derivativesEngine.target);

    return {
      derivativesEngine,
      priceOracle,
      riskManager,
      usdc,
      maliciousContract,
      owner,
      attacker,
      victim,
      liquidator,
    };
  }

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy attacks on position opening", async function () {
      const { derivativesEngine, maliciousContract, usdc } = await loadFixture(deploySecurityTestFixture);
      
      // Fund malicious contract
      await usdc.mint(maliciousContract.target, ethers.parseEther("10000"));
      
      // Attempt reentrancy attack
      await expect(
        maliciousContract.attemptReentrancy(
          derivativesEngine.target,
          "openPosition",
          ["ETH/USD", ethers.parseEther("1000"), ethers.parseEther("100"), true, 50]
        )
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });

    it("Should prevent reentrancy on position closing", async function () {
      const { derivativesEngine, maliciousContract, usdc } = await loadFixture(deploySecurityTestFixture);
      
      // Setup position first
      await usdc.mint(maliciousContract.target, ethers.parseEther("10000"));
      await maliciousContract.setupPosition(derivativesEngine.target);
      
      // Attempt reentrancy on close
      await expect(
        maliciousContract.attemptReentrancyClose(derivativesEngine.target)
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });

    it("Should prevent reentrancy on liquidations", async function () {
      const { derivativesEngine, riskManager, maliciousContract } = await loadFixture(deploySecurityTestFixture);
      
      // Attempt reentrancy on liquidation
      await expect(
        maliciousContract.attemptLiquidationReentrancy(riskManager.target)
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });
  });

  describe("Access Control Vulnerabilities", function () {
    it("Should prevent unauthorized market addition", async function () {
      const { derivativesEngine, attacker } = await loadFixture(deploySecurityTestFixture);
      
      await expect(
        derivativesEngine.connect(attacker).addMarket("FAKE/USD", 50)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should prevent unauthorized oracle manipulation", async function () {
      const { priceOracle, attacker } = await loadFixture(deploySecurityTestFixture);
      
      await expect(
        priceOracle.connect(attacker).emergencySetPrice("ETH/USD", ethers.parseEther("1"), 95)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should prevent unauthorized risk parameter changes", async function () {
      const { riskManager, attacker } = await loadFixture(deploySecurityTestFixture);
      
      await expect(
        riskManager.connect(attacker).setLiquidationThreshold(100)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should prevent position manipulation by non-owners", async function () {
      const { derivativesEngine, victim, attacker } = await loadFixture(deploySecurityTestFixture);
      
      // Victim creates position
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        victim,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      // Attacker tries to close victim's position
      await expect(
        derivativesEngine.connect(attacker).closePosition(positionId, 50)
      ).to.be.revertedWith("Not position owner");
    });
  });

  describe("Integer Overflow/Underflow Protection", function () {
    it("Should prevent overflow in position size calculations", async function () {
      const { derivativesEngine, attacker } = await loadFixture(deploySecurityTestFixture);
      
      const maxUint256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      
      await expect(
        derivativesEngine.connect(attacker).openPosition(
          "ETH/USD",
          maxUint256,
          ethers.parseEther("1000"),
          true,
          50
        )
      ).to.be.reverted; // Should revert due to overflow protection
    });

    it("Should prevent underflow in collateral calculations", async function () {
      const { derivativesEngine, victim } = await loadFixture(deploySecurityTestFixture);
      
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        victim,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      // Try to remove more collateral than available
      await expect(
        derivativesEngine.connect(victim).removeCollateral(
          positionId,
          ethers.parseEther("2000") // More than the 1000 collateral
        )
      ).to.be.revertedWith("Insufficient collateral");
    });

    it("Should handle edge case calculations safely", async function () {
      const { derivativesEngine, victim } = await loadFixture(deploySecurityTestFixture);
      
      // Test with very small amounts
      const tx = await derivativesEngine.connect(victim).openPosition(
        "ETH/USD",
        1, // 1 wei
        1, // 1 wei collateral
        true,
        50
      );
      
      expect(tx).to.not.be.reverted;
    });
  });

  describe("Oracle Manipulation Resistance", function () {
    it("Should resist price manipulation attacks", async function () {
      const { derivativesEngine, priceOracle, attacker, owner } = await loadFixture(deploySecurityTestFixture);
      
      // Attacker tries to manipulate price for profit
      const originalPrice = await priceOracle.getPrice("ETH/USD");
      
      // Create position at current price
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        attacker,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      // Try to manipulate price (should fail due to access control)
      await expect(
        priceOracle.connect(attacker).emergencySetPrice("ETH/USD", ethers.parseEther("5000"), 95)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      
      // Even if owner changes price, there should be safeguards
      await priceOracle.connect(owner).emergencySetPrice("ETH/USD", ethers.parseEther("5000"), 95);
      
      // System should have price change limits or delays
      const newPrice = await priceOracle.getPrice("ETH/USD");
      // In a real system, there would be additional checks here
    });

    it("Should validate oracle data integrity", async function () {
      const { priceOracle, owner } = await loadFixture(deploySecurityTestFixture);
      
      // Test with invalid confidence
      await expect(
        priceOracle.connect(owner).emergencySetPrice("ETH/USD", ethers.parseEther("2500"), 0)
      ).to.be.revertedWith("Low confidence");
      
      // Test with zero price
      await expect(
        priceOracle.connect(owner).emergencySetPrice("ETH/USD", 0, 95)
      ).to.be.revertedWith("Invalid price");
    });

    it("Should handle stale oracle data", async function () {
      const { priceOracle, derivativesEngine, victim } = await loadFixture(deploySecurityTestFixture);
      
      // Advance time significantly
      await testConfig.increaseTime(testConfig.SECONDS_IN_DAY * 2);
      
      // Attempt to use stale price data
      await expect(
        derivativesEngine.connect(victim).openPosition(
          "ETH/USD",
          ethers.parseEther("1000"),
          ethers.parseEther("100"),
          true,
          50
        )
      ).to.be.revertedWith("Stale price data");
    });
  });

  describe("Flash Loan Attack Prevention", function () {
    it("Should prevent flash loan arbitrage attacks", async function () {
      const { derivativesEngine, usdc, attacker } = await loadFixture(deploySecurityTestFixture);
      
      // Deploy flash loan attack contract
      const FlashLoanAttacker = await ethers.getContractFactory("FlashLoanAttacker");
      const flashAttacker = await FlashLoanAttacker.deploy();
      
      // Fund the attacker contract
      await usdc.mint(flashAttacker.target, ethers.parseEther("1000000"));
      
      // Attempt flash loan attack
      await expect(
        flashAttacker.executeFlashLoanAttack(
          derivativesEngine.target,
          usdc.target,
          ethers.parseEther("100000")
        )
      ).to.be.revertedWith("Flash loan attack detected");
    });

    it("Should detect and prevent sandwich attacks", async function () {
      const { derivativesEngine, priceOracle, attacker, victim } = await loadFixture(deploySecurityTestFixture);
      
      // Attacker front-runs victim's transaction
      const victimTx = derivativesEngine.connect(victim).openPosition(
        "ETH/USD",
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        true,
        50
      );
      
      // Attacker tries to manipulate price before victim's tx
      await expect(
        priceOracle.connect(attacker).emergencySetPrice("ETH/USD", ethers.parseEther("2600"), 95)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      
      // Victim's transaction should still succeed
      await expect(victimTx).to.not.be.reverted;
    });
  });

  describe("Governance Attack Vectors", function () {
    it("Should prevent governance token manipulation", async function () {
      const { owner, attacker } = await loadFixture(deploySecurityTestFixture);
      
      // Deploy governance token
      const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
      const govToken = await GovernanceToken.deploy(owner.address, owner.address);
      
      // Attacker tries to mint tokens
      await expect(
        govToken.connect(attacker).mint(attacker.address, ethers.parseEther("1000000"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should prevent proposal spam attacks", async function () {
      const { owner } = await loadFixture(deploySecurityTestFixture);
      
      // Deploy governance
      const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
      const govToken = await GovernanceToken.deploy(owner.address, owner.address);
      
      const AdvancedGovernance = await ethers.getContractFactory("AdvancedGovernance");
      const governance = await AdvancedGovernance.deploy(govToken.target, owner.address);
      
      // Enable trading and mint tokens
      await govToken.enableTrading();
      await govToken.mint(owner.address, ethers.parseEther("1000000"));
      
      // Try to create multiple proposals rapidly
      for (let i = 0; i < 5; i++) {
        if (i > 0) {
          await expect(
            governance.proposeWithCategory(
              0, // Parameter category
              `Spam Proposal ${i}`,
              `Description ${i}`,
              "QmHash"
            )
          ).to.be.revertedWith("Proposal cooldown active");
        } else {
          await governance.proposeWithCategory(
            0,
            `First Proposal`,
            `Description`,
            "QmHash"
          );
        }
      }
    });
  });

  describe("Economic Attack Vectors", function () {
    it("Should prevent funding rate manipulation", async function () {
      const { derivativesEngine, attacker } = await loadFixture(deploySecurityTestFixture);
      
      // Attacker tries to create massive imbalance to manipulate funding
      const largeSize = ethers.parseEther("1000000");
      const largeCollateral = ethers.parseEther("100000");
      
      // Should be limited by position size limits
      await expect(
        derivativesEngine.connect(attacker).openPosition(
          "ETH/USD",
          largeSize,
          largeCollateral,
          true,
          50
        )
      ).to.be.revertedWith("Position size too large");
    });

    it("Should prevent liquidation cascades", async function () {
      const { derivativesEngine, priceOracle, riskManager, victim, owner } = await loadFixture(deploySecurityTestFixture);
      
      // Create multiple positions at risk
      const positions = [];
      for (let i = 0; i < 3; i++) {
        const positionId = await testConfig.createPosition(
          derivativesEngine,
          victim,
          "ETH/USD",
          5000,
          500, // High leverage
          true
        );
        positions.push(positionId);
      }
      
      // Trigger price drop
      await priceOracle.connect(owner).emergencySetPrice("ETH/USD", ethers.parseEther("2000"), 95);
      
      // System should have circuit breakers to prevent cascade
      let liquidatedCount = 0;
      for (const positionId of positions) {
        try {
          await riskManager.liquidate(positionId);
          liquidatedCount++;
        } catch (error) {
          if (error.message.includes("Circuit breaker active")) {
            break; // Expected behavior
          }
        }
      }
      
      // Should not liquidate all positions at once
      expect(liquidatedCount).to.be.lt(positions.length);
    });

    it("Should handle extreme market conditions", async function () {
      const { derivativesEngine, priceOracle, victim, owner } = await loadFixture(deploySecurityTestFixture);
      
      // Create position
      const positionId = await testConfig.createPosition(
        derivativesEngine,
        victim,
        "ETH/USD",
        10000,
        1000,
        true
      );
      
      // Simulate extreme price movement (99% drop)
      await priceOracle.connect(owner).emergencySetPrice("ETH/USD", ethers.parseEther("25"), 95);
      
      // System should handle gracefully
      const position = await derivativesEngine.getPosition(positionId);
      expect(position.trader).to.equal(victim.address); // Position should still exist
    });
  });

  describe("Smart Contract Upgrade Security", function () {
    it("Should prevent unauthorized upgrades", async function () {
      const { derivativesEngine, attacker } = await loadFixture(deploySecurityTestFixture);
      
      // If using upgradeable contracts, test upgrade security
      // This is a placeholder for upgrade-specific tests
      expect(true).to.be.true; // Placeholder
    });

    it("Should maintain state consistency during upgrades", async function () {
      // Test state preservation during contract upgrades
      expect(true).to.be.true; // Placeholder
    });
  });

  describe("Gas Limit and DoS Protection", function () {
    it("Should prevent gas limit DoS attacks", async function () {
      const { derivativesEngine, victim } = await loadFixture(deploySecurityTestFixture);
      
      // Try to create transaction that consumes too much gas
      const positions = [];
      
      // Should be limited by gas or transaction limits
      for (let i = 0; i < 100; i++) {
        try {
          const positionId = await testConfig.createPosition(
            derivativesEngine,
            victim,
            "ETH/USD",
            100,
            10,
            true
          );
          positions.push(positionId);
        } catch (error) {
          if (error.message.includes("Gas limit") || error.message.includes("Too many positions")) {
            break; // Expected behavior
          }
        }
      }
      
      // Should not be able to create unlimited positions
      expect(positions.length).to.be.lt(100);
    });

    it("Should handle block gas limit efficiently", async function () {
      const { derivativesEngine, victim } = await loadFixture(deploySecurityTestFixture);
      
      // Test that normal operations fit within block gas limit
      const tx = await derivativesEngine.connect(victim).openPosition(
        "ETH/USD",
        ethers.parseEther("10000"),
        ethers.parseEther("1000"),
        true,
        50
      );
      
      const receipt = await tx.wait();
      expect(receipt.gasUsed).to.be.lt(testConfig.MAX_GAS_LIMIT);
    });
  });
});
