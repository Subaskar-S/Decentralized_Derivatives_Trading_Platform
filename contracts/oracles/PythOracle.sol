// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/IPyth.sol";

/**
 * @title PythOracle
 * @dev Pyth Network price feed adapter for low-latency price updates
 */
contract PythOracle is Ownable {
    


    struct PythFeedInfo {
        bytes32 priceId;
        uint256 maxConfidenceRatio; // Maximum confidence interval as percentage
        uint256 maxStaleness; // Maximum age in seconds
        bool isActive;
    }

    // Constants
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant MAX_CONFIDENCE_RATIO = 500; // 5% max confidence interval
    uint256 public constant MAX_STALENESS = 60; // 60 seconds for Pyth

    // State variables
    IPyth public pythContract;
    mapping(string => PythFeedInfo) public priceFeeds;
    mapping(string => uint256) public lastValidPrices;
    string[] public supportedSymbols;

    // Events
    event PythContractUpdated(address indexed newContract);
    event FeedAdded(string indexed symbol, bytes32 indexed priceId);
    event FeedRemoved(string indexed symbol);
    event PriceUpdated(string indexed symbol, uint256 price, uint256 confidence);

    constructor(address _pythContract) Ownable(msg.sender) {
        require(_pythContract != address(0), "Invalid Pyth contract");
        pythContract = IPyth(_pythContract);
    }

    /**
     * @dev Updates the Pyth contract address
     */
    function setPythContract(address _pythContract) external onlyOwner {
        require(_pythContract != address(0), "Invalid Pyth contract");
        pythContract = IPyth(_pythContract);
        emit PythContractUpdated(_pythContract);
    }

    /**
     * @dev Adds a new Pyth price feed
     */
    function addPriceFeed(
        string calldata symbol,
        bytes32 priceId,
        uint256 maxConfidenceRatio,
        uint256 maxStaleness
    ) external onlyOwner {
        require(priceId != bytes32(0), "Invalid price ID");
        require(!priceFeeds[symbol].isActive, "Feed already exists");
        require(maxConfidenceRatio <= MAX_CONFIDENCE_RATIO, "Confidence ratio too high");

        priceFeeds[symbol] = PythFeedInfo({
            priceId: priceId,
            maxConfidenceRatio: maxConfidenceRatio,
            maxStaleness: maxStaleness,
            isActive: true
        });

        supportedSymbols.push(symbol);

        emit FeedAdded(symbol, priceId);
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
     * @dev Gets the latest price from Pyth for a symbol
     */
    function getPrice(string calldata symbol) external view returns (IPriceOracle.PriceData memory) {
        PythFeedInfo memory feedInfo = priceFeeds[symbol];
        require(feedInfo.isActive, "Feed not active");

        try pythContract.getPrice(feedInfo.priceId) returns (IPyth.Price memory pythPrice) {
            return _processPythPrice(pythPrice, feedInfo);
        } catch {
            // Try unsafe price as fallback
            try pythContract.getPriceUnsafe(feedInfo.priceId) returns (IPyth.Price memory pythPrice) {
                IPriceOracle.PriceData memory priceData = _processPythPrice(pythPrice, feedInfo);
                // Reduce confidence for unsafe price
                priceData.confidence = priceData.confidence / 2;
                return priceData;
            } catch {
                return IPriceOracle.PriceData({
                    price: 0,
                    timestamp: 0,
                    confidence: 0,
                    isValid: false
                });
            }
        }
    }

    /**
     * @dev Gets EMA (Exponential Moving Average) price from Pyth
     */
    function getEmaPrice(string calldata symbol) external view returns (IPriceOracle.PriceData memory) {
        PythFeedInfo memory feedInfo = priceFeeds[symbol];
        require(feedInfo.isActive, "Feed not active");

        try pythContract.getEmaPrice(feedInfo.priceId) returns (IPyth.Price memory pythPrice) {
            return _processPythPrice(pythPrice, feedInfo);
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
     * @dev Updates price feeds with new data from Pyth
     */
    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        uint256 fee = pythContract.getUpdateFee(updateData);
        require(msg.value >= fee, "Insufficient fee");

        pythContract.updatePriceFeeds{value: fee}(updateData);

        // Refund excess payment
        if (msg.value > fee) {
            payable(msg.sender).transfer(msg.value - fee);
        }
    }

    /**
     * @dev Gets the update fee for price feed updates
     */
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256) {
        return pythContract.getUpdateFee(updateData);
    }

    /**
     * @dev Validates price against confidence and staleness thresholds
     */
    function validatePrice(
        string calldata symbol,
        IPyth.Price memory pythPrice
    ) external view returns (bool) {
        PythFeedInfo memory feedInfo = priceFeeds[symbol];
        
        // Check staleness
        if (block.timestamp - pythPrice.publishTime > feedInfo.maxStaleness) {
            return false;
        }

        // Check confidence interval
        if (pythPrice.price <= 0) {
            return false;
        }

        uint256 confidenceRatio = (uint256(uint64(pythPrice.conf)) * 10000) / uint256(uint64(pythPrice.price));
        return confidenceRatio <= feedInfo.maxConfidenceRatio;
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
        bytes32 priceId,
        uint256 maxConfidenceRatio,
        uint256 maxStaleness,
        bool isActive
    ) {
        PythFeedInfo memory info = priceFeeds[symbol];
        return (
            info.priceId,
            info.maxConfidenceRatio,
            info.maxStaleness,
            info.isActive
        );
    }

    // Internal functions
    function _processPythPrice(
        IPyth.Price memory pythPrice,
        PythFeedInfo memory feedInfo
    ) internal view returns (IPriceOracle.PriceData memory) {
        // Check if price is valid
        if (pythPrice.price <= 0) {
            return IPriceOracle.PriceData({
                price: 0,
                timestamp: 0,
                confidence: 0,
                isValid: false
            });
        }

        // Check staleness
        bool isStale = block.timestamp - pythPrice.publishTime > feedInfo.maxStaleness;

        // Convert price to 18 decimals
        uint256 price = _scalePrice(uint256(uint64(pythPrice.price)), pythPrice.expo);

        // Calculate confidence based on confidence interval
        uint256 confidence = _calculateConfidence(pythPrice, feedInfo);

        return IPriceOracle.PriceData({
            price: price,
            timestamp: pythPrice.publishTime,
            confidence: confidence,
            isValid: !isStale && confidence > 0
        });
    }

    function _scalePrice(uint256 price, int32 expo) internal pure returns (uint256) {
        if (expo >= 0) {
            return price * (10 ** uint32(expo)) * (10 ** 18);
        } else {
            uint32 negExpo = uint32(-expo);
            if (negExpo <= 18) {
                return price * (10 ** (18 - negExpo));
            } else {
                return price / (10 ** (negExpo - 18));
            }
        }
    }

    function _calculateConfidence(
        IPyth.Price memory pythPrice,
        PythFeedInfo memory feedInfo
    ) internal pure returns (uint256) {
        if (pythPrice.price <= 0 || pythPrice.conf <= 0) {
            return 0;
        }

        // Calculate confidence interval as percentage
        uint256 confidenceRatio = (uint256(uint64(pythPrice.conf)) * 10000) / uint256(uint64(pythPrice.price));
        
        if (confidenceRatio >= feedInfo.maxConfidenceRatio) {
            return 0; // No confidence if interval too wide
        }

        // Linear mapping: 0% confidence ratio = 100% confidence, max ratio = 50% confidence
        uint256 confidence = 100 - (confidenceRatio * 50) / feedInfo.maxConfidenceRatio;
        return confidence;
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

    /**
     * @dev Withdraw contract balance (for refunding excess fees)
     */
    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // Receive function to accept ETH for price updates
    receive() external payable {}
}
