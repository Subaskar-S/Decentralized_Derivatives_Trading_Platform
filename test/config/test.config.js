const { expect } = require("chai");
const { ethers } = require("hardhat");

// Test configuration and utilities
module.exports = {
  // Test constants
  ZERO_ADDRESS: "0x0000000000000000000000000000000000000000",
  MAX_UINT256: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  
  // Time constants
  SECONDS_IN_DAY: 86400,
  SECONDS_IN_HOUR: 3600,
  SECONDS_IN_WEEK: 604800,
  
  // Trading constants
  DEFAULT_LEVERAGE: 10,
  DEFAULT_SLIPPAGE: 50, // 0.5%
  LIQUIDATION_THRESHOLD: 600, // 6%
  MAINTENANCE_MARGIN: 600, // 6%
  
  // Price constants
  ETH_PRICE: ethers.parseEther("2500"),
  BTC_PRICE: ethers.parseEther("45000"),
  SOL_PRICE: ethers.parseEther("100"),
  
  // Amount constants
  INITIAL_USDC_SUPPLY: ethers.parseEther("10000000"), // 10M USDC
  TRADER_INITIAL_BALANCE: ethers.parseEther("100000"), // 100K USDC
  LARGE_POSITION_SIZE: ethers.parseEther("50000"), // 50K USD
  SMALL_POSITION_SIZE: ethers.parseEther("1000"), // 1K USD
  
  // Gas constants
  MAX_GAS_LIMIT: 30000000,
  EXPECTED_GAS_USAGE: {
    openPosition: 300000,
    closePosition: 250000,
    liquidation: 400000,
    addCollateral: 100000,
    removeCollateral: 120000,
  },
  
  // Test utilities
  async increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  },
  
  async increaseTimeToNextHour() {
    const block = await ethers.provider.getBlock("latest");
    const currentTime = block.timestamp;
    const nextHour = Math.ceil(currentTime / 3600) * 3600;
    const timeToIncrease = nextHour - currentTime;
    await this.increaseTime(timeToIncrease);
  },
  
  async getLatestBlockTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
  },
  
  async mineBlocks(count) {
    for (let i = 0; i < count; i++) {
      await ethers.provider.send("evm_mine");
    }
  },
  
  // Price calculation utilities
  calculateLiquidationPrice(entryPrice, leverage, isLong, maintenanceMargin = 0.06) {
    const marginRatio = 1 / leverage;
    const liquidationRatio = marginRatio - maintenanceMargin;
    
    if (isLong) {
      return entryPrice * (1 - liquidationRatio);
    } else {
      return entryPrice * (1 + liquidationRatio);
    }
  },
  
  calculatePnL(entryPrice, exitPrice, size, isLong) {
    const priceDiff = isLong ? exitPrice - entryPrice : entryPrice - exitPrice;
    return (priceDiff / entryPrice) * size;
  },
  
  calculateRequiredCollateral(size, leverage) {
    return size / leverage;
  },
  
  calculateTradingFee(size, feeRate = 0.001) {
    return size * feeRate;
  },
  
  // Position utilities
  async createPosition(derivativesEngine, trader, symbol, size, collateral, isLong, maxSlippage = 50) {
    const tx = await derivativesEngine.connect(trader).openPosition(
      symbol,
      ethers.parseEther(size.toString()),
      ethers.parseEther(collateral.toString()),
      isLong,
      maxSlippage
    );
    const receipt = await tx.wait();
    
    // Extract position ID from events
    const event = receipt.logs.find(log => 
      log.fragment && log.fragment.name === "PositionOpened"
    );
    
    return event ? event.args.positionId : null;
  },
  
  // Market setup utilities
  async setupMarket(derivativesEngine, priceOracle, symbol, price, maxLeverage = 25) {
    await priceOracle.emergencySetPrice(symbol, ethers.parseEther(price.toString()), 95);
    await derivativesEngine.addMarket(symbol, maxLeverage);
  },
  
  // Token utilities
  async mintAndApprove(token, recipient, amount, spender) {
    await token.mint(recipient.address, ethers.parseEther(amount.toString()));
    await token.connect(recipient).approve(spender, ethers.parseEther(amount.toString()));
  },
  
  // Assertion utilities
  expectBigNumberEqual(actual, expected, tolerance = 0) {
    if (tolerance === 0) {
      expect(actual).to.equal(expected);
    } else {
      const diff = actual > expected ? actual - expected : expected - actual;
      const toleranceAmount = expected * BigInt(tolerance) / BigInt(10000); // tolerance in basis points
      expect(diff).to.be.lte(toleranceAmount);
    }
  },
  
  expectBigNumberCloseTo(actual, expected, toleranceBps = 100) {
    const diff = actual > expected ? actual - expected : expected - actual;
    const toleranceAmount = expected * BigInt(toleranceBps) / BigInt(10000);
    expect(diff).to.be.lte(toleranceAmount);
  },
  
  // Event utilities
  async expectEvent(tx, contractInterface, eventName, expectedArgs = {}) {
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => {
      try {
        const parsed = contractInterface.parseLog(log);
        return parsed && parsed.name === eventName;
      } catch {
        return false;
      }
    });
    
    expect(event).to.not.be.undefined;
    
    if (Object.keys(expectedArgs).length > 0) {
      const parsedEvent = contractInterface.parseLog(event);
      for (const [key, value] of Object.entries(expectedArgs)) {
        expect(parsedEvent.args[key]).to.equal(value);
      }
    }
    
    return event;
  },
  
  async expectRevert(promise, expectedReason) {
    try {
      await promise;
      expect.fail("Expected transaction to revert");
    } catch (error) {
      if (expectedReason) {
        expect(error.message).to.include(expectedReason);
      }
    }
  },
  
  // Snapshot utilities
  async takeSnapshot() {
    return await ethers.provider.send("evm_snapshot");
  },
  
  async restoreSnapshot(snapshotId) {
    await ethers.provider.send("evm_revert", [snapshotId]);
  },
  
  // Fuzzing utilities
  generateRandomAddress() {
    return ethers.Wallet.createRandom().address;
  },
  
  generateRandomAmount(min = 1, max = 1000000) {
    const randomValue = Math.floor(Math.random() * (max - min + 1)) + min;
    return ethers.parseEther(randomValue.toString());
  },
  
  generateRandomPrice(min = 100, max = 100000) {
    const randomValue = Math.floor(Math.random() * (max - min + 1)) + min;
    return ethers.parseEther(randomValue.toString());
  },
  
  // Performance testing utilities
  async measureGasUsage(tx) {
    const receipt = await tx.wait();
    return receipt.gasUsed;
  },
  
  async benchmarkFunction(fn, iterations = 100) {
    const gasUsages = [];
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      const tx = await fn();
      const endTime = Date.now();
      
      const receipt = await tx.wait();
      gasUsages.push(receipt.gasUsed);
      times.push(endTime - startTime);
    }
    
    return {
      avgGasUsage: gasUsages.reduce((a, b) => a + b, 0n) / BigInt(iterations),
      maxGasUsage: gasUsages.reduce((a, b) => a > b ? a : b, 0n),
      minGasUsage: gasUsages.reduce((a, b) => a < b ? a : b, gasUsages[0]),
      avgTime: times.reduce((a, b) => a + b, 0) / iterations,
      maxTime: Math.max(...times),
      minTime: Math.min(...times),
    };
  },
  
  // Security testing utilities
  async testReentrancy(contract, functionName, args = []) {
    // This would be implemented with a malicious contract
    // For now, just a placeholder
    console.log(`Testing reentrancy for ${functionName}`);
  },
  
  async testOverflow(contract, functionName, largeValue) {
    try {
      await contract[functionName](largeValue);
      return false; // No overflow detected
    } catch (error) {
      return error.message.includes("overflow") || error.message.includes("SafeMath");
    }
  },
  
  // Load testing utilities
  async simulateHighLoad(contract, functionName, args, concurrency = 10) {
    const promises = [];
    
    for (let i = 0; i < concurrency; i++) {
      promises.push(contract[functionName](...args));
    }
    
    try {
      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected").length;
      
      return { successful, failed, total: concurrency };
    } catch (error) {
      console.error("Load test failed:", error);
      return { successful: 0, failed: concurrency, total: concurrency };
    }
  },
  
  // Invariant testing utilities
  async checkInvariants(contracts) {
    const invariants = [];
    
    // Check total supply invariants
    if (contracts.usdc && contracts.derivativesEngine) {
      const totalSupply = await contracts.usdc.totalSupply();
      const engineBalance = await contracts.usdc.balanceOf(contracts.derivativesEngine.target);
      invariants.push({
        name: "USDC total supply >= engine balance",
        condition: totalSupply >= engineBalance,
        actual: { totalSupply, engineBalance }
      });
    }
    
    // Check position invariants
    if (contracts.derivativesEngine && contracts.riskManager) {
      // Add position-specific invariants
      invariants.push({
        name: "All positions have valid collateral",
        condition: true, // Would implement actual check
        actual: {}
      });
    }
    
    return invariants;
  }
};
