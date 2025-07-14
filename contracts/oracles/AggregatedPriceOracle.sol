// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IPriceOracle.sol";

/**
 * @title AggregatedPriceOracle
 * @dev Advanced price oracle that aggregates Chainlink and Pyth data with TWAP and fallback mechanisms
 */
contract AggregatedPriceOracle is IPriceOracle, Ownable, ReentrancyGuard {
    
    struct OracleSource {
        address oracle;
        uint256 weight;
        uint256 priority; // Lower number = higher priority
        bool isActive;
        string sourceType; // "chainlink" or "pyth"
    }

    struct PriceHistory {
        uint256 price;
        uint256 timestamp;
        uint256 confidence;
    }

    struct MarketConfig {
        uint256 maxPriceDeviation; // Maximum allowed price deviation between sources (basis points)
        uint256 minConfidence; // Minimum confidence threshold
        uint256 maxPriceAge; // Maximum age for valid prices
        bool requireMultipleSources; // Whether multiple sources are required
    }

    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant DEFAULT_MAX_DEVIATION = 500; // 5%
    uint256 public constant DEFAULT_MIN_CONFIDENCE = 80; // 80%
    uint256 public constant DEFAULT_MAX_AGE = 3600; // 1 hour
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant MAX_HISTORY_SIZE = 200;

    // State variables
    mapping(string => OracleSource[]) public oracleSources;
    mapping(string => PriceData) public latestPrices;
    mapping(string => PriceHistory[]) public priceHistory;
    mapping(string => MarketConfig) public marketConfigs;
    mapping(string => uint256) public lastUpdateTimes;
    
    string[] public supportedSymbols;
    uint256 public totalSources;

    // Events
    event SourceAdded(string indexed symbol, address indexed oracle, string sourceType, uint256 weight);
    event SourceRemoved(string indexed symbol, address indexed oracle);
    event PriceAggregated(string indexed symbol, uint256 price, uint256 confidence, uint256 sourceCount);
    event FallbackTriggered(string indexed symbol, string reason);
    event MarketConfigUpdated(string indexed symbol, MarketConfig config);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Adds an oracle source for a symbol
     */
    function addOracleSource(
        string calldata symbol,
        address oracle,
        string calldata sourceType,
        uint256 weight,
        uint256 priority
    ) external onlyOwner {
        require(oracle != address(0), "Invalid oracle address");
        require(weight > 0, "Invalid weight");
        require(
            keccak256(bytes(sourceType)) == keccak256(bytes("chainlink")) ||
            keccak256(bytes(sourceType)) == keccak256(bytes("pyth")),
            "Invalid source type"
        );

        // Check if symbol exists in supported list
        bool symbolExists = false;
        for (uint256 i = 0; i < supportedSymbols.length; i++) {
            if (keccak256(bytes(supportedSymbols[i])) == keccak256(bytes(symbol))) {
                symbolExists = true;
                break;
            }
        }
        if (!symbolExists) {
            supportedSymbols.push(symbol);
            // Set default market config
            marketConfigs[symbol] = MarketConfig({
                maxPriceDeviation: DEFAULT_MAX_DEVIATION,
                minConfidence: DEFAULT_MIN_CONFIDENCE,
                maxPriceAge: DEFAULT_MAX_AGE,
                requireMultipleSources: true
            });
        }

        oracleSources[symbol].push(OracleSource({
            oracle: oracle,
            weight: weight,
            priority: priority,
            isActive: true,
            sourceType: sourceType
        }));

        totalSources++;

        emit SourceAdded(symbol, oracle, sourceType, weight);
    }

    /**
     * @dev Removes an oracle source
     */
    function removeOracleSource(string calldata symbol, address oracle) external onlyOwner {
        OracleSource[] storage sources = oracleSources[symbol];
        
        for (uint256 i = 0; i < sources.length; i++) {
            if (sources[i].oracle == oracle) {
                sources[i] = sources[sources.length - 1];
                sources.pop();
                totalSources--;
                emit SourceRemoved(symbol, oracle);
                return;
            }
        }
        
        revert("Oracle source not found");
    }

    /**
     * @dev Gets aggregated price for a symbol
     */
    function getPrice(string calldata symbol) external view returns (PriceData memory) {
        PriceData memory cachedPrice = latestPrices[symbol];
        MarketConfig memory config = marketConfigs[symbol];
        
        // Check if cached price is still valid
        if (cachedPrice.isValid && 
            block.timestamp - cachedPrice.timestamp <= config.maxPriceAge &&
            cachedPrice.confidence >= config.minConfidence) {
            return cachedPrice;
        }

        // Aggregate prices from all sources
        return _aggregatePrices(symbol);
    }

    /**
     * @dev Updates prices from all sources for a symbol
     */
    function updatePrice(string calldata symbol) external nonReentrant {
        PriceData memory aggregatedPrice = _aggregatePrices(symbol);
        
        if (aggregatedPrice.isValid) {
            latestPrices[symbol] = aggregatedPrice;
            lastUpdateTimes[symbol] = block.timestamp;
            
            // Add to price history
            _addToPriceHistory(symbol, aggregatedPrice);
            
            emit PriceUpdated(symbol, aggregatedPrice.price, aggregatedPrice.timestamp, msg.sender);
        }
    }

    /**
     * @dev Calculates TWAP over a specified period
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
     * @dev Sets market configuration
     */
    function setMarketConfig(
        string calldata symbol,
        MarketConfig calldata config
    ) external onlyOwner {
        require(config.maxPriceDeviation <= 2000, "Deviation too high"); // Max 20%
        require(config.minConfidence <= 100, "Invalid confidence");
        require(config.maxPriceAge > 0, "Invalid max age");
        
        marketConfigs[symbol] = config;
        emit MarketConfigUpdated(symbol, config);
    }

    /**
     * @dev Checks if price is valid for a symbol
     */
    function isValidPrice(string calldata symbol) external view returns (bool) {
        PriceData memory priceData = latestPrices[symbol];
        MarketConfig memory config = marketConfigs[symbol];
        
        return priceData.isValid && 
               (block.timestamp - priceData.timestamp <= config.maxPriceAge) &&
               priceData.confidence >= config.minConfidence;
    }

    /**
     * @dev Gets last update time for a symbol
     */
    function getLastUpdateTime(string calldata symbol) external view returns (uint256) {
        return lastUpdateTimes[symbol];
    }

    /**
     * @dev Gets number of oracle sources
     */
    function getOracleCount() external view returns (uint256) {
        return totalSources;
    }

    /**
     * @dev Gets oracle sources for a symbol
     */
    function getOracleSources(string calldata symbol) external view returns (OracleSource[] memory) {
        return oracleSources[symbol];
    }

    /**
     * @dev Gets supported symbols
     */
    function getSupportedSymbols() external view returns (string[] memory) {
        return supportedSymbols;
    }

    /**
     * @dev Emergency price override
     */
    function emergencySetPrice(
        string calldata symbol,
        uint256 price,
        uint256 confidence
    ) external onlyOwner {
        latestPrices[symbol] = PriceData({
            price: price,
            timestamp: block.timestamp,
            confidence: confidence,
            isValid: true
        });

        emit PriceUpdated(symbol, price, block.timestamp, msg.sender);
    }

    /**
     * @dev Adds an oracle (legacy interface compatibility)
     */
    function addOracle(
        address oracle,
        string calldata name,
        uint256 weight
    ) external onlyOwner {
        // This is a simplified implementation for interface compatibility
        // Use addOracleSource for full functionality
        // Simplified implementation - just add to first supported symbol or ETH/USD
        string memory symbol = supportedSymbols.length > 0 ? supportedSymbols[0] : "ETH/USD";
        this.addOracleSource(symbol, oracle, name, weight, 1);
    }

    /**
     * @dev Removes an oracle (legacy interface compatibility)
     */
    function removeOracle(address oracle) external onlyOwner {
        // Remove from all symbols - simplified implementation
        for (uint256 i = 0; i < supportedSymbols.length; i++) {
            try this.removeOracleSource(supportedSymbols[i], oracle) {
                // Successfully removed
            } catch {
                // Oracle not found for this symbol, continue
            }
        }
    }

    /**
     * @dev Sets oracle weight (legacy interface compatibility)
     */
    function setOracleWeight(address oracle, uint256 weight) external onlyOwner {
        // Update weight for all symbols where this oracle exists
        for (uint256 i = 0; i < supportedSymbols.length; i++) {
            OracleSource[] storage sources = oracleSources[supportedSymbols[i]];
            for (uint256 j = 0; j < sources.length; j++) {
                if (sources[j].oracle == oracle) {
                    sources[j].weight = weight;
                }
            }
        }
    }

    // Internal functions
    function _aggregatePrices(string memory symbol) internal view returns (PriceData memory) {
        OracleSource[] memory sources = oracleSources[symbol];
        MarketConfig memory config = marketConfigs[symbol];
        
        if (sources.length == 0) {
            return PriceData(0, 0, 0, false);
        }

        // Collect valid prices from all sources
        uint256[] memory prices = new uint256[](sources.length);
        uint256[] memory weights = new uint256[](sources.length);
        uint256[] memory confidences = new uint256[](sources.length);
        uint256[] memory timestamps = new uint256[](sources.length);
        uint256 validCount = 0;

        for (uint256 i = 0; i < sources.length; i++) {
            if (!sources[i].isActive) continue;

            try this._fetchPriceFromSource(sources[i].oracle, symbol, sources[i].sourceType) 
                returns (PriceData memory priceData) {
                
                if (priceData.isValid && 
                    priceData.confidence >= config.minConfidence &&
                    block.timestamp - priceData.timestamp <= config.maxPriceAge) {
                    
                    prices[validCount] = priceData.price;
                    weights[validCount] = sources[i].weight;
                    confidences[validCount] = priceData.confidence;
                    timestamps[validCount] = priceData.timestamp;
                    validCount++;
                }
            } catch {
                // Skip failed sources
                continue;
            }
        }

        if (validCount == 0) {
            return PriceData(0, 0, 0, false);
        }

        if (config.requireMultipleSources && validCount < 2) {
            return PriceData(0, 0, 0, false);
        }

        // Calculate weighted average
        return _calculateWeightedAverage(prices, weights, confidences, timestamps, validCount);
    }

    function _fetchPriceFromSource(
        address oracle,
        string memory symbol,
        string memory sourceType
    ) external view returns (PriceData memory) {
        // This function needs to be external to use try/catch
        if (keccak256(bytes(sourceType)) == keccak256(bytes("chainlink"))) {
            return _fetchFromChainlink(oracle, symbol);
        } else if (keccak256(bytes(sourceType)) == keccak256(bytes("pyth"))) {
            return _fetchFromPyth(oracle, symbol);
        } else {
            return PriceData(0, 0, 0, false);
        }
    }

    function _fetchFromChainlink(address oracle, string memory symbol) internal view returns (PriceData memory) {
        // Interface with ChainlinkOracle contract
        (bool success, bytes memory data) = oracle.staticcall(
            abi.encodeWithSignature("getPrice(string)", symbol)
        );
        
        if (success) {
            return abi.decode(data, (PriceData));
        }
        
        return PriceData(0, 0, 0, false);
    }

    function _fetchFromPyth(address oracle, string memory symbol) internal view returns (PriceData memory) {
        // Interface with PythOracle contract
        (bool success, bytes memory data) = oracle.staticcall(
            abi.encodeWithSignature("getPrice(string)", symbol)
        );
        
        if (success) {
            return abi.decode(data, (PriceData));
        }
        
        return PriceData(0, 0, 0, false);
    }

    function _calculateWeightedAverage(
        uint256[] memory prices,
        uint256[] memory weights,
        uint256[] memory confidences,
        uint256[] memory timestamps,
        uint256 count
    ) internal pure returns (PriceData memory) {
        uint256 weightedSum = 0;
        uint256 totalWeight = 0;
        uint256 avgConfidence = 0;
        uint256 minTimestamp = type(uint256).max;

        for (uint256 i = 0; i < count; i++) {
            weightedSum += prices[i] * weights[i];
            totalWeight += weights[i];
            avgConfidence += confidences[i] * weights[i];
            
            if (timestamps[i] < minTimestamp) {
                minTimestamp = timestamps[i];
            }
        }

        return PriceData({
            price: weightedSum / totalWeight,
            timestamp: minTimestamp,
            confidence: avgConfidence / totalWeight,
            isValid: true
        });
    }

    function _addToPriceHistory(string memory symbol, PriceData memory priceData) internal {
        priceHistory[symbol].push(PriceHistory({
            price: priceData.price,
            timestamp: priceData.timestamp,
            confidence: priceData.confidence
        }));

        // Limit history size
        if (priceHistory[symbol].length > MAX_HISTORY_SIZE) {
            // Remove oldest entry
            for (uint256 i = 0; i < priceHistory[symbol].length - 1; i++) {
                priceHistory[symbol][i] = priceHistory[symbol][i + 1];
            }
            priceHistory[symbol].pop();
        }
    }
}
