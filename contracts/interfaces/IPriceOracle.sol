// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPriceOracle
 * @dev Interface for price oracle aggregation
 */
interface IPriceOracle {
    struct PriceData {
        uint256 price;
        uint256 timestamp;
        uint256 confidence;
        bool isValid;
    }

    // Events
    event PriceUpdated(
        string indexed symbol,
        uint256 price,
        uint256 timestamp,
        address oracle
    );

    event OracleAdded(
        address indexed oracle,
        string name,
        uint256 weight
    );

    event OracleRemoved(address indexed oracle);

    // Core functions
    function getPrice(string calldata symbol) external view returns (PriceData memory);
    function getTWAP(string calldata symbol, uint256 period) external view returns (uint256);
    function updatePrice(string calldata symbol) external;
    
    // Admin functions
    function addOracle(
        address oracle,
        string calldata name,
        uint256 weight
    ) external;

    function removeOracle(address oracle) external;
    function setOracleWeight(address oracle, uint256 weight) external;
    
    // View functions
    function isValidPrice(string calldata symbol) external view returns (bool);
    function getLastUpdateTime(string calldata symbol) external view returns (uint256);
    function getOracleCount() external view returns (uint256);
}
