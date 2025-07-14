// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/AggregatorV3Interface.sol";

/**
 * @title ChainlinkOracle
 * @dev Chainlink price feed adapter for the derivatives platform
 */
contract ChainlinkOracle is Ownable {
    


    struct FeedInfo {
        AggregatorV3Interface feed;
        uint8 decimals;
        uint256 heartbeat; // Maximum time between updates
        bool isActive;
    }

    // Constants
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant MAX_PRICE_DEVIATION = 1000; // 10% in basis points
    uint256 public constant STALE_PRICE_THRESHOLD = 3600; // 1 hour

    // State variables
    mapping(string => FeedInfo) public priceFeeds;
    mapping(string => uint256) public lastValidPrices;
    string[] public supportedSymbols;

    // Events
    event FeedAdded(string indexed symbol, address indexed feed, uint8 decimals);
    event FeedRemoved(string indexed symbol);
    event PriceFetched(string indexed symbol, uint256 price, uint256 timestamp);
    event StalePriceDetected(string indexed symbol, uint256 lastUpdate);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Adds a new Chainlink price feed
     */
    function addPriceFeed(
        string calldata symbol,
        address feedAddress,
        uint256 heartbeat
    ) external onlyOwner {
        require(feedAddress != address(0), "Invalid feed address");
        require(!priceFeeds[symbol].isActive, "Feed already exists");

        AggregatorV3Interface feed = AggregatorV3Interface(feedAddress);
        uint8 decimals = feed.decimals();

        priceFeeds[symbol] = FeedInfo({
            feed: feed,
            decimals: decimals,
            heartbeat: heartbeat,
            isActive: true
        });

        supportedSymbols.push(symbol);

        emit FeedAdded(symbol, feedAddress, decimals);
    }

    /**
     * @dev Removes a price feed
     */
    function removePriceFeed(string calldata symbol) external onlyOwner {
        require(priceFeeds[symbol].isActive, "Feed not active");
        
        priceFeeds[symbol].isActive = false;
        
        // Remove from supported symbols array
        for (uint256 i = 0; i < supportedSymbols.length; i++) {
            if (keccak256(bytes(supportedSymbols[i])) == keccak256(bytes(symbol))) {
                supportedSymbols[i] = supportedSymbols[supportedSymbols.length - 1];
                supportedSymbols.pop();
                break;
            }
        }

        emit FeedRemoved(symbol);
    }

    /**
     * @dev Gets the latest price from Chainlink for a symbol
     */
    function getPrice(string calldata symbol) external view returns (IPriceOracle.PriceData memory) {
        FeedInfo memory feedInfo = priceFeeds[symbol];
        require(feedInfo.isActive, "Feed not active");

        try feedInfo.feed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            require(answer > 0, "Invalid price");
            require(updatedAt > 0, "Invalid timestamp");
            require(roundId == answeredInRound, "Stale price");

            // Check if price is stale
            bool isStale = block.timestamp - updatedAt > feedInfo.heartbeat;
            
            // Convert price to 18 decimals
            uint256 price = _scalePrice(uint256(answer), feedInfo.decimals);
            
            // Calculate confidence based on freshness
            uint256 confidence = _calculateConfidence(updatedAt, feedInfo.heartbeat);

            return IPriceOracle.PriceData({
                price: price,
                timestamp: updatedAt,
                confidence: confidence,
                isValid: !isStale
            });

        } catch {
            // Return invalid data if feed fails
            return IPriceOracle.PriceData({
                price: 0,
                timestamp: 0,
                confidence: 0,
                isValid: false
            });
        }
    }

    /**
     * @dev Gets historical price data for TWAP calculations
     */
    function getHistoricalPrice(
        string calldata symbol,
        uint80 roundId
    ) external view returns (IPriceOracle.PriceData memory) {
        FeedInfo memory feedInfo = priceFeeds[symbol];
        require(feedInfo.isActive, "Feed not active");

        try feedInfo.feed.getRoundData(roundId) returns (
            uint80 returnedRoundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            require(answer > 0, "Invalid price");
            require(updatedAt > 0, "Invalid timestamp");

            uint256 price = _scalePrice(uint256(answer), feedInfo.decimals);
            
            return IPriceOracle.PriceData({
                price: price,
                timestamp: updatedAt,
                confidence: 100, // Historical data is considered fully confident
                isValid: true
            });

        } catch {
            return IPriceOracle.PriceData({
                price: 0,
                timestamp: 0,
                confidence: 0,
                isValid: false
            });
        }
    }

    /**
     * @dev Validates price against deviation threshold
     */
    function validatePrice(string calldata symbol, uint256 newPrice) external view returns (bool) {
        uint256 lastPrice = lastValidPrices[symbol];
        if (lastPrice == 0) return true; // First price is always valid

        uint256 deviation = newPrice > lastPrice 
            ? ((newPrice - lastPrice) * 10000) / lastPrice
            : ((lastPrice - newPrice) * 10000) / lastPrice;

        return deviation <= MAX_PRICE_DEVIATION;
    }

    /**
     * @dev Updates the last valid price for a symbol
     */
    function updateLastValidPrice(string calldata symbol, uint256 price) external onlyOwner {
        lastValidPrices[symbol] = price;
    }

    /**
     * @dev Gets all supported symbols
     */
    function getSupportedSymbols() external view returns (string[] memory) {
        return supportedSymbols;
    }

    /**
     * @dev Checks if a symbol is supported
     */
    function isSymbolSupported(string calldata symbol) external view returns (bool) {
        return priceFeeds[symbol].isActive;
    }

    /**
     * @dev Gets feed information for a symbol
     */
    function getFeedInfo(string calldata symbol) external view returns (
        address feedAddress,
        uint8 decimals,
        uint256 heartbeat,
        bool isActive
    ) {
        FeedInfo memory info = priceFeeds[symbol];
        return (
            address(info.feed),
            info.decimals,
            info.heartbeat,
            info.isActive
        );
    }

    // Internal functions
    function _scalePrice(uint256 price, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 18) {
            return price;
        } else if (decimals < 18) {
            return price * (10 ** (18 - decimals));
        } else {
            return price / (10 ** (decimals - 18));
        }
    }

    function _calculateConfidence(uint256 updatedAt, uint256 heartbeat) internal view returns (uint256) {
        uint256 age = block.timestamp - updatedAt;
        
        if (age >= heartbeat) {
            return 0; // No confidence for stale prices
        }
        
        // Linear decay: 100% confidence at 0 age, 80% at heartbeat
        uint256 confidence = 100 - (age * 20) / heartbeat;
        return confidence > 80 ? confidence : 80;
    }

    /**
     * @dev Emergency function to pause a feed
     */
    function pauseFeed(string calldata symbol) external onlyOwner {
        require(priceFeeds[symbol].isActive, "Feed not active");
        priceFeeds[symbol].isActive = false;
    }

    /**
     * @dev Emergency function to resume a feed
     */
    function resumeFeed(string calldata symbol) external onlyOwner {
        require(!priceFeeds[symbol].isActive, "Feed already active");
        priceFeeds[symbol].isActive = true;
    }
}
