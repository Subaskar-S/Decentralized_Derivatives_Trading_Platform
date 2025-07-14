// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title L2GasManager
 * @dev Optimizes gas usage for L2 rollups with dynamic pricing and batching
 */
contract L2GasManager is Ownable {
    
    struct GasConfig {
        uint256 baseGasPrice;
        uint256 priorityFeePerGas;
        uint256 maxFeePerGas;
        uint256 gasLimit;
        bool dynamicPricing;
    }

    struct TransactionBatch {
        bytes32 batchId;
        address[] targets;
        bytes[] calldatas;
        uint256[] values;
        uint256 totalGasEstimate;
        uint256 timestamp;
        bool executed;
    }

    // L2-specific optimizations
    uint256 public constant L1_GAS_PRICE_ORACLE = 0x420000000000000000000000000000000000000F;
    uint256 public constant OPTIMISM_GAS_PRICE_ORACLE = 0x420000000000000000000000000000000000000F;
    
    // Gas configuration per operation type
    mapping(string => GasConfig) public gasConfigs;
    mapping(bytes32 => TransactionBatch) public batches;
    mapping(address => uint256) public userGasCredits;
    
    uint256 public batchCounter;
    uint256 public totalGasSaved;
    uint256 public l1GasPriceCache;
    uint256 public lastL1GasUpdate;
    
    // Events
    event GasConfigUpdated(string operationType, GasConfig config);
    event BatchCreated(bytes32 indexed batchId, uint256 transactionCount);
    event BatchExecuted(bytes32 indexed batchId, uint256 gasUsed, uint256 gasSaved);
    event GasCreditAdded(address indexed user, uint256 amount);
    event L1GasPriceUpdated(uint256 newPrice);

    constructor() Ownable(msg.sender) {
        _initializeGasConfigs();
    }

    /**
     * @dev Creates a transaction batch for gas optimization
     */
    function createBatch(
        address[] calldata targets,
        bytes[] calldata calldatas,
        uint256[] calldata values
    ) external returns (bytes32 batchId) {
        require(targets.length == calldatas.length, "Array length mismatch");
        require(targets.length == values.length, "Array length mismatch");
        require(targets.length > 1, "Batch must contain multiple transactions");
        require(targets.length <= 50, "Batch too large");
        
        batchId = keccak256(abi.encodePacked(
            block.timestamp,
            msg.sender,
            batchCounter++
        ));
        
        uint256 totalGasEstimate = _estimateBatchGas(targets, calldatas, values);
        
        batches[batchId] = TransactionBatch({
            batchId: batchId,
            targets: targets,
            calldatas: calldatas,
            values: values,
            totalGasEstimate: totalGasEstimate,
            timestamp: block.timestamp,
            executed: false
        });
        
        emit BatchCreated(batchId, targets.length);
        return batchId;
    }

    /**
     * @dev Executes a transaction batch with gas optimization
     */
    function executeBatch(bytes32 batchId) external {
        TransactionBatch storage batch = batches[batchId];
        require(!batch.executed, "Batch already executed");
        require(batch.targets.length > 0, "Batch not found");
        
        uint256 gasStart = gasleft();
        uint256 successCount = 0;
        
        for (uint256 i = 0; i < batch.targets.length; i++) {
            (bool success,) = batch.targets[i].call{
                value: batch.values[i]
            }(batch.calldatas[i]);
            
            if (success) {
                successCount++;
            }
        }
        
        uint256 gasUsed = gasStart - gasleft();
        uint256 estimatedIndividualGas = batch.targets.length * 21000; // Base transaction cost
        uint256 gasSaved = estimatedIndividualGas > gasUsed ? estimatedIndividualGas - gasUsed : 0;
        
        batch.executed = true;
        totalGasSaved += gasSaved;
        
        emit BatchExecuted(batchId, gasUsed, gasSaved);
    }

    /**
     * @dev Optimizes gas price based on L1 costs and network conditions
     */
    function getOptimizedGasPrice(string calldata operationType) external view returns (
        uint256 gasPrice,
        uint256 gasLimit
    ) {
        GasConfig memory config = gasConfigs[operationType];
        
        if (config.dynamicPricing) {
            // Get current L1 gas price for rollup cost calculation
            uint256 l1GasPrice = _getL1GasPrice();
            
            // Calculate optimized gas price based on L1 costs
            gasPrice = _calculateOptimizedGasPrice(l1GasPrice, config);
        } else {
            gasPrice = config.baseGasPrice;
        }
        
        gasLimit = config.gasLimit;
        return (gasPrice, gasLimit);
    }

    /**
     * @dev Estimates total L2 cost including L1 data availability
     */
    function estimateL2Cost(
        bytes calldata data,
        uint256 gasLimit
    ) external view returns (
        uint256 l2ExecutionCost,
        uint256 l1DataCost,
        uint256 totalCost
    ) {
        // L2 execution cost
        l2ExecutionCost = gasLimit * _getCurrentL2GasPrice();
        
        // L1 data availability cost (simplified calculation)
        l1DataCost = _calculateL1DataCost(data);
        
        totalCost = l2ExecutionCost + l1DataCost;
        
        return (l2ExecutionCost, l1DataCost, totalCost);
    }

    /**
     * @dev Adds gas credits for a user (for subsidized transactions)
     */
    function addGasCredits(address user, uint256 amount) external onlyOwner {
        userGasCredits[user] += amount;
        emit GasCreditAdded(user, amount);
    }

    /**
     * @dev Uses gas credits to pay for transaction
     */
    function useGasCredits(address user, uint256 amount) external returns (bool) {
        if (userGasCredits[user] >= amount) {
            userGasCredits[user] -= amount;
            return true;
        }
        return false;
    }

    /**
     * @dev Updates L1 gas price cache
     */
    function updateL1GasPrice() external {
        require(block.timestamp >= lastL1GasUpdate + 300, "Too frequent updates"); // 5 min cooldown
        
        uint256 newL1GasPrice = _getL1GasPrice();
        l1GasPriceCache = newL1GasPrice;
        lastL1GasUpdate = block.timestamp;
        
        emit L1GasPriceUpdated(newL1GasPrice);
    }

    /**
     * @dev Sets gas configuration for operation type
     */
    function setGasConfig(
        string calldata operationType,
        GasConfig calldata config
    ) external onlyOwner {
        require(config.gasLimit > 0, "Invalid gas limit");
        gasConfigs[operationType] = config;
        emit GasConfigUpdated(operationType, config);
    }

    // Internal functions
    function _initializeGasConfigs() internal {
        // Trading operations
        gasConfigs["openPosition"] = GasConfig({
            baseGasPrice: 1000000, // 0.001 gwei
            priorityFeePerGas: 1000000,
            maxFeePerGas: 2000000,
            gasLimit: 300000,
            dynamicPricing: true
        });
        
        gasConfigs["closePosition"] = GasConfig({
            baseGasPrice: 1000000,
            priorityFeePerGas: 1000000,
            maxFeePerGas: 2000000,
            gasLimit: 250000,
            dynamicPricing: true
        });
        
        gasConfigs["liquidation"] = GasConfig({
            baseGasPrice: 2000000, // Higher priority for liquidations
            priorityFeePerGas: 2000000,
            maxFeePerGas: 5000000,
            gasLimit: 400000,
            dynamicPricing: true
        });
        
        gasConfigs["governance"] = GasConfig({
            baseGasPrice: 1000000,
            priorityFeePerGas: 500000,
            maxFeePerGas: 1500000,
            gasLimit: 200000,
            dynamicPricing: false
        });
    }

    function _estimateBatchGas(
        address[] calldata targets,
        bytes[] calldata calldatas,
        uint256[] calldata values
    ) internal pure returns (uint256 totalGas) {
        totalGas = 21000; // Base transaction cost
        
        for (uint256 i = 0; i < targets.length; i++) {
            totalGas += 21000; // Base cost per call
            totalGas += calldatas[i].length * 16; // Data cost
            if (values[i] > 0) {
                totalGas += 9000; // ETH transfer cost
            }
        }
        
        return totalGas;
    }

    function _getL1GasPrice() internal view returns (uint256) {
        // In production, this would call the L1 gas price oracle
        // For now, return cached value or default
        return l1GasPriceCache > 0 ? l1GasPriceCache : 20 gwei;
    }

    function _getCurrentL2GasPrice() internal view returns (uint256) {
        // Get current L2 gas price (very low on Optimism)
        return 0.001 gwei;
    }

    function _calculateL1DataCost(bytes calldata data) internal view returns (uint256) {
        // Simplified L1 data cost calculation
        // In production, would use the actual L1 gas price oracle
        uint256 l1GasPrice = _getL1GasPrice();
        uint256 dataGas = data.length * 16; // 16 gas per byte
        
        return dataGas * l1GasPrice;
    }

    function _calculateOptimizedGasPrice(
        uint256 l1GasPrice,
        GasConfig memory config
    ) internal pure returns (uint256) {
        // Dynamic pricing based on L1 costs
        uint256 l1Factor = l1GasPrice / 1 gwei; // Normalize to gwei
        uint256 adjustment = (config.baseGasPrice * l1Factor) / 20; // Adjust based on L1 price
        
        uint256 optimizedPrice = config.baseGasPrice + adjustment;
        
        // Cap at max fee
        return optimizedPrice > config.maxFeePerGas ? config.maxFeePerGas : optimizedPrice;
    }

    // View functions
    function getBatchInfo(bytes32 batchId) external view returns (
        address[] memory targets,
        uint256 transactionCount,
        uint256 gasEstimate,
        bool executed
    ) {
        TransactionBatch memory batch = batches[batchId];
        return (
            batch.targets,
            batch.targets.length,
            batch.totalGasEstimate,
            batch.executed
        );
    }

    function getGasSavings() external view returns (uint256) {
        return totalGasSaved;
    }

    function getUserGasCredits(address user) external view returns (uint256) {
        return userGasCredits[user];
    }
}
