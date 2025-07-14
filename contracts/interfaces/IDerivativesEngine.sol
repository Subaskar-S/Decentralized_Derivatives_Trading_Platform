// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IDerivativesEngine
 * @dev Interface for the core derivatives trading engine
 */
interface IDerivativesEngine {
    struct Position {
        address trader;
        uint256 size;
        uint256 collateral;
        uint256 entryPrice;
        uint256 entryTime;
        bool isLong;
        uint256 fundingIndex;
    }

    struct Market {
        string symbol;
        uint256 maxLeverage;
        uint256 fundingRate;
        uint256 lastFundingTime;
        uint256 openInterestLong;
        uint256 openInterestShort;
        bool isActive;
    }

    // Events
    event PositionOpened(
        address indexed trader,
        bytes32 indexed positionId,
        string symbol,
        uint256 size,
        uint256 collateral,
        uint256 entryPrice,
        bool isLong
    );

    event PositionClosed(
        address indexed trader,
        bytes32 indexed positionId,
        uint256 exitPrice,
        int256 pnl
    );

    event FundingRateUpdated(
        string indexed symbol,
        uint256 fundingRate,
        uint256 timestamp
    );

    // Core functions
    function openPosition(
        string calldata symbol,
        uint256 size,
        uint256 collateral,
        bool isLong,
        uint256 maxSlippage
    ) external returns (bytes32 positionId);

    function closePosition(
        bytes32 positionId,
        uint256 maxSlippage
    ) external returns (int256 pnl);

    function addCollateral(
        bytes32 positionId,
        uint256 amount
    ) external;

    function removeCollateral(
        bytes32 positionId,
        uint256 amount
    ) external;

    function liquidatePosition(
        bytes32 positionId
    ) external returns (uint256 liquidationReward);

    function updateFundingRate(string calldata symbol) external;

    // View functions
    function getPosition(bytes32 positionId) external view returns (Position memory);
    function getMarket(string calldata symbol) external view returns (Market memory);
    function calculatePnL(bytes32 positionId) external view returns (int256);
    function getMarginRatio(bytes32 positionId) external view returns (uint256);
    function getFundingPayment(bytes32 positionId) external view returns (int256);
}
