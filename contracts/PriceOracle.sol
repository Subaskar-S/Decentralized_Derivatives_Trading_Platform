// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IPriceOracle.sol";

/**
 * @title PriceOracle
 * @dev Aggregated price oracle with multiple data sources and TWAP functionality
 */
contract PriceOracle is IPriceOracle, Ownable {
    
    struct OracleInfo {
        string name;
        uint256 weight;
        bool isActive;
    }

    struct PriceHistory {
        uint256 price;
        uint256 timestamp;
    }

    // Constants
    uint256 public constant MAX_PRICE_AGE = 1 hours;
    uint256 public constant MIN_CONFIDENCE = 80; // 80%
    uint256 public constant PRICE_PRECISION = 1e18;

    // State variables
    mapping(string => PriceData) public latestPrices;
    mapping(string => PriceHistory[]) public priceHistory;
    mapping(address => OracleInfo) public oracles;
    address[] public oracleList;
    
    uint256 public totalWeight;

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Gets the latest aggregated price for a symbol
     */
    function getPrice(string calldata symbol) external view returns (PriceData memory) {
        PriceData memory priceData = latestPrices[symbol];
        
        // Check if price is still valid (not too old)
        if (block.timestamp - priceData.timestamp > MAX_PRICE_AGE) {
            priceData.isValid = false;
        }
        
        return priceData;
    }

    /**
     * @dev Calculates Time-Weighted Average Price (TWAP) over a specified period
     */
    function getTWAP(string calldata symbol, uint256 period) external view returns (uint256) {
        PriceHistory[] storage history = priceHistory[symbol];
        require(history.length > 0, "No price history");
        
        uint256 cutoffTime = block.timestamp - period;
        uint256 weightedSum = 0;
        uint256 totalTime = 0;
        
        for (uint256 i = history.length; i > 0; i--) {
            uint256 index = i - 1;
            if (history[index].timestamp < cutoffTime) break;
            
            uint256 timeWeight;
            if (index == history.length - 1) {
                timeWeight = block.timestamp - history[index].timestamp;
            } else {
                timeWeight = history[index + 1].timestamp - history[index].timestamp;
            }
            
            weightedSum += history[index].price * timeWeight;
            totalTime += timeWeight;
        }
        
        require(totalTime > 0, "Insufficient price history");
        return weightedSum / totalTime;
    }

    /**
     * @dev Updates price for a symbol (called by authorized oracles)
     */
    function updatePrice(string calldata symbol) external {
        require(oracles[msg.sender].isActive, "Unauthorized oracle");
        
        // In a real implementation, this would fetch price from the oracle
        // For now, we'll use a placeholder mechanism
        _updatePriceInternal(symbol, _fetchPriceFromOracle(symbol, msg.sender));
    }

    /**
     * @dev Adds a new oracle to the system
     */
    function addOracle(
        address oracle,
        string calldata name,
        uint256 weight
    ) external onlyOwner {
        require(oracle != address(0), "Invalid oracle address");
        require(weight > 0, "Invalid weight");
        require(!oracles[oracle].isActive, "Oracle already exists");

        oracles[oracle] = OracleInfo({
            name: name,
            weight: weight,
            isActive: true
        });
        
        oracleList.push(oracle);
        totalWeight += weight;

        emit OracleAdded(oracle, name, weight);
    }

    /**
     * @dev Removes an oracle from the system
     */
    function removeOracle(address oracle) external onlyOwner {
        require(oracles[oracle].isActive, "Oracle not active");
        
        totalWeight -= oracles[oracle].weight;
        oracles[oracle].isActive = false;
        
        // Remove from oracle list
        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracleList[i] == oracle) {
                oracleList[i] = oracleList[oracleList.length - 1];
                oracleList.pop();
                break;
            }
        }

        emit OracleRemoved(oracle);
    }

    /**
     * @dev Sets the weight of an oracle
     */
    function setOracleWeight(address oracle, uint256 weight) external onlyOwner {
        require(oracles[oracle].isActive, "Oracle not active");
        require(weight > 0, "Invalid weight");
        
        totalWeight = totalWeight - oracles[oracle].weight + weight;
        oracles[oracle].weight = weight;
    }

    /**
     * @dev Checks if a price is valid for a symbol
     */
    function isValidPrice(string calldata symbol) external view returns (bool) {
        PriceData memory priceData = latestPrices[symbol];
        return priceData.isValid && 
               (block.timestamp - priceData.timestamp <= MAX_PRICE_AGE) &&
               priceData.confidence >= MIN_CONFIDENCE;
    }

    /**
     * @dev Gets the last update time for a symbol
     */
    function getLastUpdateTime(string calldata symbol) external view returns (uint256) {
        return latestPrices[symbol].timestamp;
    }

    /**
     * @dev Gets the number of active oracles
     */
    function getOracleCount() external view returns (uint256) {
        return oracleList.length;
    }

    /**
     * @dev Emergency function to manually set price (only owner)
     */
    function emergencySetPrice(
        string calldata symbol,
        uint256 price,
        uint256 confidence
    ) external onlyOwner {
        _updatePriceInternal(symbol, PriceData({
            price: price,
            timestamp: block.timestamp,
            confidence: confidence,
            isValid: true
        }));
    }

    // Internal functions
    function _updatePriceInternal(string calldata symbol, PriceData memory newPrice) internal {
        // Store in latest prices
        latestPrices[symbol] = newPrice;
        
        // Add to price history
        priceHistory[symbol].push(PriceHistory({
            price: newPrice.price,
            timestamp: newPrice.timestamp
        }));
        
        // Limit history size (keep last 100 entries)
        if (priceHistory[symbol].length > 100) {
            // Shift array left (remove oldest entry)
            for (uint256 i = 0; i < priceHistory[symbol].length - 1; i++) {
                priceHistory[symbol][i] = priceHistory[symbol][i + 1];
            }
            priceHistory[symbol].pop();
        }

        emit PriceUpdated(symbol, newPrice.price, newPrice.timestamp, msg.sender);
    }

    function _fetchPriceFromOracle(
        string calldata symbol, 
        address oracle
    ) internal view returns (PriceData memory) {
        // Placeholder implementation
        // In a real system, this would interface with Chainlink, Pyth, etc.
        
        // Mock price data for testing
        uint256 mockPrice;
        if (keccak256(bytes(symbol)) == keccak256(bytes("ETH/USD"))) {
            mockPrice = 2000 * PRICE_PRECISION; // $2000
        } else if (keccak256(bytes(symbol)) == keccak256(bytes("BTC/USD"))) {
            mockPrice = 40000 * PRICE_PRECISION; // $40000
        } else {
            mockPrice = 1 * PRICE_PRECISION; // $1 default
        }
        
        return PriceData({
            price: mockPrice,
            timestamp: block.timestamp,
            confidence: 95, // 95% confidence
            isValid: true
        });
    }

    /**
     * @dev Aggregates prices from multiple oracles (weighted average)
     */
    function _aggregatePrices(string calldata symbol) internal view returns (PriceData memory) {
        require(oracleList.length > 0, "No oracles available");
        
        uint256 weightedSum = 0;
        uint256 totalActiveWeight = 0;
        uint256 minTimestamp = block.timestamp;
        uint256 avgConfidence = 0;
        
        for (uint256 i = 0; i < oracleList.length; i++) {
            address oracle = oracleList[i];
            if (!oracles[oracle].isActive) continue;
            
            PriceData memory oraclePrice = _fetchPriceFromOracle(symbol, oracle);
            if (!oraclePrice.isValid) continue;
            
            uint256 weight = oracles[oracle].weight;
            weightedSum += oraclePrice.price * weight;
            totalActiveWeight += weight;
            avgConfidence += oraclePrice.confidence * weight;
            
            if (oraclePrice.timestamp < minTimestamp) {
                minTimestamp = oraclePrice.timestamp;
            }
        }
        
        require(totalActiveWeight > 0, "No valid oracle prices");
        
        return PriceData({
            price: weightedSum / totalActiveWeight,
            timestamp: minTimestamp,
            confidence: avgConfidence / totalActiveWeight,
            isValid: true
        });
    }
}
