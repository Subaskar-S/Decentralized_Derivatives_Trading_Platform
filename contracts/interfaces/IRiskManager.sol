// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IRiskManager
 * @dev Interface for risk management and liquidation system
 */
interface IRiskManager {
    struct RiskParameters {
        uint256 initialMarginRatio;    // e.g., 10% = 1000 (basis points)
        uint256 maintenanceMarginRatio; // e.g., 6% = 600 (basis points)
        uint256 liquidationFeeRatio;   // e.g., 1% = 100 (basis points)
        uint256 maxLeverage;           // e.g., 10x = 10
        uint256 maxPositionSize;       // Maximum position size in USD
    }

    // Events
    event LiquidationTriggered(
        bytes32 indexed positionId,
        address indexed liquidator,
        uint256 liquidationPrice,
        uint256 liquidationFee
    );

    event RiskParametersUpdated(
        string indexed symbol,
        RiskParameters parameters
    );

    event MarginCall(
        bytes32 indexed positionId,
        uint256 currentMarginRatio,
        uint256 requiredMarginRatio
    );

    // Core functions
    function checkLiquidation(bytes32 positionId) external view returns (bool canLiquidate);
    function liquidate(bytes32 positionId) external returns (uint256 liquidationReward);
    function calculateMarginRatio(bytes32 positionId) external view returns (uint256);
    function calculateLiquidationPrice(bytes32 positionId) external view returns (uint256);
    
    // Risk parameter management
    function setRiskParameters(
        string calldata symbol,
        RiskParameters calldata parameters
    ) external;

    function getRiskParameters(string calldata symbol) 
        external view returns (RiskParameters memory);

    // View functions
    function isPositionHealthy(bytes32 positionId) external view returns (bool);
    function getRequiredMargin(
        string calldata symbol,
        uint256 size,
        uint256 leverage
    ) external view returns (uint256);
    
    function canOpenPosition(
        address trader,
        string calldata symbol,
        uint256 size,
        uint256 collateral
    ) external view returns (bool);
}
