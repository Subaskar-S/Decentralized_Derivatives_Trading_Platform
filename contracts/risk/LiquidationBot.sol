// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IRiskManager.sol";
import "../interfaces/IDerivativesEngine.sol";
import "../interfaces/IPriceOracle.sol";

/**
 * @title LiquidationBot
 * @dev Automated liquidation system with keeper network integration
 */
contract LiquidationBot is Ownable, ReentrancyGuard {
    
    struct LiquidationTarget {
        bytes32 positionId;
        address trader;
        uint256 marginRatio;
        uint256 priority;
        uint256 lastUpdate;
        bool isActive;
    }

    struct BotConfig {
        uint256 minMarginRatio;      // Minimum margin ratio to monitor
        uint256 maxGasPrice;         // Maximum gas price for liquidations
        uint256 profitThreshold;     // Minimum profit threshold
        uint256 maxPositionsPerTx;   // Max positions to liquidate per transaction
        bool isActive;
    }

    struct KeeperInfo {
        address keeper;
        uint256 totalLiquidations;
        uint256 totalRewards;
        uint256 gasUsed;
        bool isActive;
    }

    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MAX_TARGETS = 1000;
    uint256 public constant UPDATE_INTERVAL = 300; // 5 minutes

    // State variables
    IRiskManager public riskManager;
    IDerivativesEngine public derivativesEngine;
    IPriceOracle public priceOracle;
    IERC20 public collateralToken;

    mapping(bytes32 => LiquidationTarget) public liquidationTargets;
    mapping(address => KeeperInfo) public keepers;
    mapping(string => BotConfig) public botConfigs;
    
    bytes32[] public activeTargets;
    address[] public activeKeepers;
    
    uint256 public lastGlobalUpdate;
    uint256 public totalLiquidations;
    uint256 public totalGasSaved;

    // Events
    event TargetAdded(bytes32 indexed positionId, uint256 marginRatio, uint256 priority);
    event TargetRemoved(bytes32 indexed positionId, string reason);
    event LiquidationExecuted(bytes32 indexed positionId, address indexed keeper, uint256 reward, uint256 gasUsed);
    event KeeperRegistered(address indexed keeper);
    event BotConfigUpdated(string indexed symbol, BotConfig config);
    event EmergencyStop(string reason);

    constructor(
        address _riskManager,
        address _derivativesEngine,
        address _priceOracle,
        address _collateralToken
    ) Ownable(msg.sender) {
        riskManager = IRiskManager(_riskManager);
        derivativesEngine = IDerivativesEngine(_derivativesEngine);
        priceOracle = IPriceOracle(_priceOracle);
        collateralToken = IERC20(_collateralToken);
        
        // Set default bot config
        botConfigs["default"] = BotConfig({
            minMarginRatio: 800,        // 8%
            maxGasPrice: 50 gwei,
            profitThreshold: 10 * 1e18, // $10
            maxPositionsPerTx: 5,
            isActive: true
        });
    }

    /**
     * @dev Registers a keeper for automated liquidations
     */
    function registerKeeper() external {
        require(!keepers[msg.sender].isActive, "Already registered");
        
        keepers[msg.sender] = KeeperInfo({
            keeper: msg.sender,
            totalLiquidations: 0,
            totalRewards: 0,
            gasUsed: 0,
            isActive: true
        });
        
        activeKeepers.push(msg.sender);
        emit KeeperRegistered(msg.sender);
    }

    /**
     * @dev Adds a position to liquidation monitoring
     */
    function addLiquidationTarget(bytes32 positionId) external {
        require(liquidationTargets[positionId].positionId == bytes32(0), "Target already exists");
        require(activeTargets.length < MAX_TARGETS, "Too many targets");
        
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        require(position.trader != address(0), "Position not found");
        
        uint256 marginRatio = riskManager.calculateMarginRatio(positionId);
        uint256 priority = _calculatePriority(marginRatio, position.size);
        
        liquidationTargets[positionId] = LiquidationTarget({
            positionId: positionId,
            trader: position.trader,
            marginRatio: marginRatio,
            priority: priority,
            lastUpdate: block.timestamp,
            isActive: true
        });
        
        activeTargets.push(positionId);
        emit TargetAdded(positionId, marginRatio, priority);
    }

    /**
     * @dev Removes a position from monitoring
     */
    function removeLiquidationTarget(bytes32 positionId, string calldata reason) external {
        require(liquidationTargets[positionId].isActive, "Target not active");
        
        liquidationTargets[positionId].isActive = false;
        _removeFromActiveTargets(positionId);
        
        emit TargetRemoved(positionId, reason);
    }

    /**
     * @dev Updates all liquidation targets (keeper function)
     */
    function updateLiquidationTargets() external {
        require(keepers[msg.sender].isActive, "Not authorized keeper");
        require(block.timestamp >= lastGlobalUpdate + UPDATE_INTERVAL, "Too frequent updates");
        
        uint256 gasStart = gasleft();
        uint256 updatedCount = 0;
        uint256 removedCount = 0;
        
        for (uint256 i = 0; i < activeTargets.length && updatedCount < 50; i++) {
            bytes32 positionId = activeTargets[i];
            LiquidationTarget storage target = liquidationTargets[positionId];
            
            if (!target.isActive) continue;
            
            // Check if position still exists
            IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
            if (position.trader == address(0)) {
                target.isActive = false;
                removedCount++;
                continue;
            }
            
            // Update margin ratio and priority
            uint256 newMarginRatio = riskManager.calculateMarginRatio(positionId);
            target.marginRatio = newMarginRatio;
            target.priority = _calculatePriority(newMarginRatio, position.size);
            target.lastUpdate = block.timestamp;
            
            updatedCount++;
        }
        
        lastGlobalUpdate = block.timestamp;
        
        // Update keeper stats
        uint256 gasUsed = gasStart - gasleft();
        keepers[msg.sender].gasUsed += gasUsed;
        totalGasSaved += gasUsed;
        
        // Clean up inactive targets
        if (removedCount > 0) {
            _cleanupInactiveTargets();
        }
    }

    /**
     * @dev Executes liquidations for eligible positions
     */
    function executeLiquidations(bytes32[] calldata positionIds) external nonReentrant {
        require(keepers[msg.sender].isActive, "Not authorized keeper");
        require(tx.gasprice <= botConfigs["default"].maxGasPrice, "Gas price too high");
        require(positionIds.length <= botConfigs["default"].maxPositionsPerTx, "Too many positions");
        
        uint256 gasStart = gasleft();
        uint256 totalRewards = 0;
        uint256 successfulLiquidations = 0;
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            bytes32 positionId = positionIds[i];
            
            // Verify position is liquidatable
            if (!riskManager.checkLiquidation(positionId)) continue;
            
            // Check profit threshold
            uint256 estimatedReward = _estimateLiquidationReward(positionId);
            if (estimatedReward < botConfigs["default"].profitThreshold) continue;
            
            try riskManager.liquidate(positionId) returns (uint256 reward) {
                totalRewards += reward;
                successfulLiquidations++;
                
                // Remove from monitoring
                liquidationTargets[positionId].isActive = false;
                
                emit LiquidationExecuted(positionId, msg.sender, reward, gasStart - gasleft());
            } catch {
                // Liquidation failed, continue with next position
                continue;
            }
        }
        
        // Update keeper stats
        uint256 gasUsed = gasStart - gasleft();
        KeeperInfo storage keeper = keepers[msg.sender];
        keeper.totalLiquidations += successfulLiquidations;
        keeper.totalRewards += totalRewards;
        keeper.gasUsed += gasUsed;
        
        totalLiquidations += successfulLiquidations;
        
        // Transfer rewards to keeper
        if (totalRewards > 0) {
            collateralToken.transfer(msg.sender, totalRewards);
        }
    }

    /**
     * @dev Gets liquidation targets sorted by priority
     */
    function getLiquidationTargets(uint256 limit) external view returns (LiquidationTarget[] memory) {
        uint256 count = activeTargets.length > limit ? limit : activeTargets.length;
        LiquidationTarget[] memory targets = new LiquidationTarget[](count);
        
        // Simple implementation - in production would use a priority queue
        uint256 added = 0;
        for (uint256 i = 0; i < activeTargets.length && added < count; i++) {
            bytes32 positionId = activeTargets[i];
            if (liquidationTargets[positionId].isActive) {
                targets[added] = liquidationTargets[positionId];
                added++;
            }
        }
        
        return targets;
    }

    /**
     * @dev Gets high priority liquidation targets
     */
    function getHighPriorityTargets() external view returns (bytes32[] memory) {
        bytes32[] memory highPriorityTargets = new bytes32[](activeTargets.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < activeTargets.length; i++) {
            bytes32 positionId = activeTargets[i];
            LiquidationTarget memory target = liquidationTargets[positionId];
            
            if (target.isActive && target.priority > 8000) { // High priority (80%+)
                highPriorityTargets[count] = positionId;
                count++;
            }
        }
        
        // Resize array
        bytes32[] memory result = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = highPriorityTargets[i];
        }
        
        return result;
    }

    /**
     * @dev Estimates liquidation reward for a position
     */
    function estimateLiquidationReward(bytes32 positionId) external view returns (uint256) {
        return _estimateLiquidationReward(positionId);
    }

    /**
     * @dev Checks if keeper can perform liquidations
     */
    function canExecuteLiquidations(address keeper) external view returns (bool) {
        return keepers[keeper].isActive && 
               tx.gasprice <= botConfigs["default"].maxGasPrice &&
               botConfigs["default"].isActive;
    }

    /**
     * @dev Sets bot configuration
     */
    function setBotConfig(string calldata symbol, BotConfig calldata config) external onlyOwner {
        require(config.minMarginRatio > 0, "Invalid margin ratio");
        require(config.maxGasPrice > 0, "Invalid gas price");
        
        botConfigs[symbol] = config;
        emit BotConfigUpdated(symbol, config);
    }

    /**
     * @dev Emergency stop function
     */
    function emergencyStop(string calldata reason) external onlyOwner {
        botConfigs["default"].isActive = false;
        emit EmergencyStop(reason);
    }

    /**
     * @dev Resumes bot operations
     */
    function resumeOperations() external onlyOwner {
        botConfigs["default"].isActive = true;
    }

    // Internal functions
    function _calculatePriority(uint256 marginRatio, uint256 positionSize) internal pure returns (uint256) {
        // Higher priority for lower margin ratios and larger positions
        uint256 marginPriority = marginRatio > 0 ? (10000 * 1000) / marginRatio : 10000;
        uint256 sizePriority = positionSize / 1e18; // Size in dollars
        
        // Combine priorities (weighted 70% margin, 30% size)
        return (marginPriority * 70 + sizePriority * 30) / 100;
    }

    function _estimateLiquidationReward(bytes32 positionId) internal view returns (uint256) {
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        if (position.trader == address(0)) return 0;
        
        // Simplified reward calculation - 1% of position size
        return position.size / 100;
    }

    function _removeFromActiveTargets(bytes32 positionId) internal {
        for (uint256 i = 0; i < activeTargets.length; i++) {
            if (activeTargets[i] == positionId) {
                activeTargets[i] = activeTargets[activeTargets.length - 1];
                activeTargets.pop();
                break;
            }
        }
    }

    function _cleanupInactiveTargets() internal {
        uint256 writeIndex = 0;
        for (uint256 readIndex = 0; readIndex < activeTargets.length; readIndex++) {
            if (liquidationTargets[activeTargets[readIndex]].isActive) {
                if (writeIndex != readIndex) {
                    activeTargets[writeIndex] = activeTargets[readIndex];
                }
                writeIndex++;
            }
        }
        
        // Resize array
        while (activeTargets.length > writeIndex) {
            activeTargets.pop();
        }
    }

    // View functions
    function getActiveTargetsCount() external view returns (uint256) {
        return activeTargets.length;
    }

    function getActiveKeepersCount() external view returns (uint256) {
        return activeKeepers.length;
    }

    function getBotStats() external view returns (
        uint256 totalTargets,
        uint256 totalKeepers,
        uint256 totalLiquidationsExecuted,
        uint256 totalGasOptimized
    ) {
        return (
            activeTargets.length,
            activeKeepers.length,
            totalLiquidations,
            totalGasSaved
        );
    }
}
