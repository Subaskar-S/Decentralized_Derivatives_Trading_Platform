// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BatchExecutor
 * @dev Optimized batch transaction executor for L2 rollups
 * Reduces gas costs by batching multiple operations in single transaction
 */
contract BatchExecutor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct BatchCall {
        address target;
        uint256 value;
        bytes data;
        bool requireSuccess;
    }

    struct BatchResult {
        bool success;
        bytes returnData;
        uint256 gasUsed;
    }

    struct TradeOperation {
        address trader;
        string symbol;
        uint256 size;
        uint256 collateral;
        bool isLong;
        uint256 maxSlippage;
        uint8 operationType; // 0: open, 1: close, 2: modify
    }

    struct LiquidationOperation {
        bytes32 positionId;
        address liquidator;
        uint256 expectedReward;
    }

    // Constants for L2 optimization
    uint256 public constant MAX_BATCH_SIZE = 50;
    uint256 public constant GAS_BUFFER = 50000;
    
    // State variables
    mapping(address => bool) public authorizedCallers;
    mapping(address => uint256) public nonces;
    
    uint256 public totalBatchesExecuted;
    uint256 public totalGasSaved;
    
    // Events
    event BatchExecuted(
        address indexed executor,
        uint256 batchSize,
        uint256 successCount,
        uint256 gasUsed
    );
    
    event TradesBatched(
        address indexed executor,
        uint256 tradeCount,
        uint256 totalVolume
    );
    
    event LiquidationsBatched(
        address indexed executor,
        uint256 liquidationCount,
        uint256 totalRewards
    );

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Executes a batch of arbitrary calls
     */
    function executeBatch(
        BatchCall[] calldata calls
    ) external onlyAuthorized nonReentrant returns (BatchResult[] memory results) {
        require(calls.length > 0 && calls.length <= MAX_BATCH_SIZE, "Invalid batch size");
        
        uint256 gasStart = gasleft();
        results = new BatchResult[](calls.length);
        uint256 successCount = 0;
        
        for (uint256 i = 0; i < calls.length; i++) {
            uint256 callGasStart = gasleft();
            
            (bool success, bytes memory returnData) = calls[i].target.call{
                value: calls[i].value
            }(calls[i].data);
            
            uint256 gasUsed = callGasStart - gasleft();
            
            results[i] = BatchResult({
                success: success,
                returnData: returnData,
                gasUsed: gasUsed
            });
            
            if (success) {
                successCount++;
            } else if (calls[i].requireSuccess) {
                revert("Required call failed");
            }
        }
        
        uint256 totalGasUsed = gasStart - gasleft();
        totalBatchesExecuted++;
        
        emit BatchExecuted(msg.sender, calls.length, successCount, totalGasUsed);
        
        return results;
    }

    /**
     * @dev Batches multiple trade operations for gas efficiency
     */
    function batchTrades(
        TradeOperation[] calldata trades,
        address derivativesEngine
    ) external onlyAuthorized nonReentrant returns (bytes32[] memory positionIds) {
        require(trades.length > 0 && trades.length <= MAX_BATCH_SIZE, "Invalid batch size");
        
        positionIds = new bytes32[](trades.length);
        uint256 totalVolume = 0;
        
        for (uint256 i = 0; i < trades.length; i++) {
            TradeOperation memory trade = trades[i];
            totalVolume += trade.size;
            
            if (trade.operationType == 0) {
                // Open position
                bytes memory callData = abi.encodeWithSignature(
                    "openPosition(string,uint256,uint256,bool,uint256)",
                    trade.symbol,
                    trade.size,
                    trade.collateral,
                    trade.isLong,
                    trade.maxSlippage
                );
                
                (bool success, bytes memory returnData) = derivativesEngine.call(callData);
                if (success) {
                    positionIds[i] = abi.decode(returnData, (bytes32));
                }
            } else if (trade.operationType == 1) {
                // Close position - would need position ID in trade struct
                // Implementation depends on specific close position interface
            }
        }
        
        emit TradesBatched(msg.sender, trades.length, totalVolume);
        return positionIds;
    }

    /**
     * @dev Batches multiple liquidations for gas efficiency
     */
    function batchLiquidations(
        LiquidationOperation[] calldata liquidations,
        address riskManager
    ) external onlyAuthorized nonReentrant returns (uint256[] memory rewards) {
        require(liquidations.length > 0 && liquidations.length <= MAX_BATCH_SIZE, "Invalid batch size");
        
        rewards = new uint256[](liquidations.length);
        uint256 totalRewards = 0;
        
        for (uint256 i = 0; i < liquidations.length; i++) {
            LiquidationOperation memory liq = liquidations[i];
            
            bytes memory callData = abi.encodeWithSignature(
                "liquidate(bytes32)",
                liq.positionId
            );
            
            (bool success, bytes memory returnData) = riskManager.call(callData);
            if (success) {
                uint256 reward = abi.decode(returnData, (uint256));
                rewards[i] = reward;
                totalRewards += reward;
            }
        }
        
        emit LiquidationsBatched(msg.sender, liquidations.length, totalRewards);
        return rewards;
    }

    /**
     * @dev Optimized batch approval for multiple tokens
     */
    function batchApprovals(
        address[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts
    ) external nonReentrant {
        require(
            tokens.length == spenders.length && 
            tokens.length == amounts.length,
            "Array length mismatch"
        );
        require(tokens.length <= MAX_BATCH_SIZE, "Batch too large");
        
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).safeApprove(spenders[i], amounts[i]);
        }
    }

    /**
     * @dev Batch token transfers with single approval check
     */
    function batchTransfers(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        require(recipients.length == amounts.length, "Array length mismatch");
        require(recipients.length <= MAX_BATCH_SIZE, "Batch too large");
        
        IERC20 tokenContract = IERC20(token);
        uint256 totalAmount = 0;
        
        // Calculate total amount needed
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        
        // Single allowance check
        require(
            tokenContract.allowance(msg.sender, address(this)) >= totalAmount,
            "Insufficient allowance"
        );
        
        // Execute transfers
        for (uint256 i = 0; i < recipients.length; i++) {
            tokenContract.safeTransferFrom(msg.sender, recipients[i], amounts[i]);
        }
    }

    /**
     * @dev Gas-optimized batch position updates
     */
    function batchPositionUpdates(
        bytes32[] calldata positionIds,
        uint256[] calldata newCollaterals,
        address derivativesEngine
    ) external onlyAuthorized nonReentrant {
        require(positionIds.length == newCollaterals.length, "Array length mismatch");
        require(positionIds.length <= MAX_BATCH_SIZE, "Batch too large");
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            bytes memory callData = abi.encodeWithSignature(
                "addCollateral(bytes32,uint256)",
                positionIds[i],
                newCollaterals[i]
            );
            
            (bool success,) = derivativesEngine.call(callData);
            require(success, "Position update failed");
        }
    }

    /**
     * @dev Estimates gas for batch execution
     */
    function estimateBatchGas(
        BatchCall[] calldata calls
    ) external view returns (uint256 estimatedGas) {
        // Simple estimation - in production would use more sophisticated method
        estimatedGas = calls.length * 50000 + GAS_BUFFER;
        
        for (uint256 i = 0; i < calls.length; i++) {
            // Add estimated gas per call based on data size
            estimatedGas += calls[i].data.length * 16; // 16 gas per byte
        }
        
        return estimatedGas;
    }

    /**
     * @dev Optimized multicall with gas limit per call
     */
    function multicallWithGasLimit(
        BatchCall[] calldata calls,
        uint256 gasLimitPerCall
    ) external onlyAuthorized nonReentrant returns (BatchResult[] memory results) {
        require(calls.length > 0 && calls.length <= MAX_BATCH_SIZE, "Invalid batch size");
        
        results = new BatchResult[](calls.length);
        
        for (uint256 i = 0; i < calls.length; i++) {
            uint256 gasStart = gasleft();
            
            // Ensure we have enough gas for this call plus buffer
            if (gasStart < gasLimitPerCall + GAS_BUFFER) {
                results[i] = BatchResult({
                    success: false,
                    returnData: "Insufficient gas",
                    gasUsed: 0
                });
                continue;
            }
            
            (bool success, bytes memory returnData) = calls[i].target.call{
                gas: gasLimitPerCall,
                value: calls[i].value
            }(calls[i].data);
            
            uint256 gasUsed = gasStart - gasleft();
            
            results[i] = BatchResult({
                success: success,
                returnData: returnData,
                gasUsed: gasUsed
            });
        }
        
        return results;
    }

    // Admin functions
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    // View functions
    function getBatchStats() external view returns (
        uint256 totalBatches,
        uint256 gasSaved
    ) {
        return (totalBatchesExecuted, totalGasSaved);
    }

    function isAuthorized(address caller) external view returns (bool) {
        return authorizedCallers[caller] || caller == owner();
    }

    // Receive function to accept ETH
    receive() external payable {}
}
