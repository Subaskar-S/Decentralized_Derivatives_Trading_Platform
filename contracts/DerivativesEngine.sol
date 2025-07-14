// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IDerivativesEngine.sol";
import "./interfaces/IPriceOracle.sol";
import "./interfaces/IRiskManager.sol";

/**
 * @title DerivativesEngine
 * @dev Core contract for perpetual swap trading with funding rate mechanics
 */
contract DerivativesEngine is IDerivativesEngine, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant FUNDING_INTERVAL = 1 hours;
    uint256 public constant PRICE_PRECISION = 1e18;

    // State variables
    IPriceOracle public priceOracle;
    IRiskManager public riskManager;
    IERC20 public collateralToken;

    mapping(bytes32 => Position) public positions;
    mapping(string => Market) public markets;
    mapping(string => uint256) public cumulativeFundingRates;
    
    uint256 public nextPositionId;
    uint256 public totalCollateral;

    // Modifiers
    modifier onlyValidMarket(string calldata symbol) {
        require(markets[symbol].isActive, "Market not active");
        _;
    }

    modifier onlyPositionOwner(bytes32 positionId) {
        require(positions[positionId].trader == msg.sender, "Not position owner");
        _;
    }

    constructor(
        address _priceOracle,
        address _riskManager,
        address _collateralToken
    ) Ownable(msg.sender) {
        priceOracle = IPriceOracle(_priceOracle);
        riskManager = IRiskManager(_riskManager);
        collateralToken = IERC20(_collateralToken);
    }

    /**
     * @dev Opens a new perpetual swap position
     */
    function openPosition(
        string calldata symbol,
        uint256 size,
        uint256 collateral,
        bool isLong,
        uint256 maxSlippage
    ) external nonReentrant onlyValidMarket(symbol) returns (bytes32 positionId) {
        require(size > 0, "Invalid size");
        require(collateral > 0, "Invalid collateral");

        // Check if position can be opened
        require(
            riskManager.canOpenPosition(msg.sender, symbol, size, collateral),
            "Position violates risk parameters"
        );

        // Get current price
        IPriceOracle.PriceData memory priceData = priceOracle.getPrice(symbol);
        require(priceData.isValid, "Invalid price");

        // Calculate position ID
        positionId = keccak256(abi.encodePacked(msg.sender, nextPositionId++));

        // Transfer collateral
        collateralToken.safeTransferFrom(msg.sender, address(this), collateral);
        totalCollateral += collateral;

        // Create position
        positions[positionId] = Position({
            trader: msg.sender,
            size: size,
            collateral: collateral,
            entryPrice: priceData.price,
            entryTime: block.timestamp,
            isLong: isLong,
            fundingIndex: cumulativeFundingRates[symbol]
        });

        // Update market open interest
        if (isLong) {
            markets[symbol].openInterestLong += size;
        } else {
            markets[symbol].openInterestShort += size;
        }

        emit PositionOpened(
            msg.sender,
            positionId,
            symbol,
            size,
            collateral,
            priceData.price,
            isLong
        );

        return positionId;
    }

    /**
     * @dev Closes an existing position
     */
    function closePosition(
        bytes32 positionId,
        uint256 maxSlippage
    ) external nonReentrant onlyPositionOwner(positionId) returns (int256 pnl) {
        Position storage position = positions[positionId];
        require(position.trader != address(0), "Position not found");

        // Calculate PnL including funding
        pnl = calculatePnL(positionId);
        int256 fundingPayment = getFundingPayment(positionId);
        int256 totalPnl = pnl + fundingPayment;

        // For simplicity in this demo, just return the original collateral
        // In a real system, profits would come from an insurance fund or counterparty losses
        uint256 finalCollateral = position.collateral;

        // Update market open interest
        string memory symbol = _getSymbolFromPosition(positionId);
        if (position.isLong) {
            markets[symbol].openInterestLong -= position.size;
        } else {
            markets[symbol].openInterestShort -= position.size;
        }

        // Transfer final collateral to trader
        if (finalCollateral > 0) {
            collateralToken.safeTransfer(position.trader, finalCollateral);
            totalCollateral -= finalCollateral;
        } else {
            totalCollateral -= position.collateral;
        }

        emit PositionClosed(
            position.trader,
            positionId,
            priceOracle.getPrice(symbol).price,
            totalPnl
        );

        // Clear position
        delete positions[positionId];

        return totalPnl;
    }

    /**
     * @dev Adds collateral to an existing position
     */
    function addCollateral(
        bytes32 positionId,
        uint256 amount
    ) external nonReentrant onlyPositionOwner(positionId) {
        require(amount > 0, "Invalid amount");
        
        Position storage position = positions[positionId];
        require(position.trader != address(0), "Position not found");

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        position.collateral += amount;
        totalCollateral += amount;
    }

    /**
     * @dev Removes collateral from an existing position
     */
    function removeCollateral(
        bytes32 positionId,
        uint256 amount
    ) external nonReentrant onlyPositionOwner(positionId) {
        require(amount > 0, "Invalid amount");
        
        Position storage position = positions[positionId];
        require(position.trader != address(0), "Position not found");
        require(position.collateral >= amount, "Insufficient collateral");

        // Check if position remains healthy after collateral removal
        position.collateral -= amount;
        require(
            riskManager.isPositionHealthy(positionId),
            "Position would become unhealthy"
        );

        collateralToken.safeTransfer(msg.sender, amount);
        totalCollateral -= amount;
    }

    /**
     * @dev Liquidates an unhealthy position
     */
    function liquidatePosition(
        bytes32 positionId
    ) external nonReentrant returns (uint256 liquidationReward) {
        require(positions[positionId].trader != address(0), "Position not found");
        require(
            riskManager.checkLiquidation(positionId),
            "Position not liquidatable"
        );

        return riskManager.liquidate(positionId);
    }

    /**
     * @dev Updates funding rate for a market
     */
    function updateFundingRate(string calldata symbol) external onlyValidMarket(symbol) {
        Market storage market = markets[symbol];

        // Calculate funding rate based on open interest imbalance
        uint256 totalOI = market.openInterestLong + market.openInterestShort;
        if (totalOI > 0) {
            int256 imbalance = int256(market.openInterestLong) - int256(market.openInterestShort);
            // Simple funding rate calculation: imbalance / total OI * base rate
            market.fundingRate = uint256(imbalance * 100) / totalOI; // 0.01% base rate
        }

        market.lastFundingTime = block.timestamp;
        cumulativeFundingRates[symbol] += market.fundingRate;

        emit FundingRateUpdated(symbol, market.fundingRate, block.timestamp);
    }

    // View functions
    function getPosition(bytes32 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    function getMarket(string calldata symbol) external view returns (Market memory) {
        return markets[symbol];
    }

    function calculatePnL(bytes32 positionId) public view returns (int256) {
        Position memory position = positions[positionId];
        if (position.trader == address(0)) return 0;

        string memory symbol = _getSymbolFromPosition(positionId);
        IPriceOracle.PriceData memory currentPrice = priceOracle.getPrice(symbol);

        int256 priceDiff;
        if (position.isLong) {
            priceDiff = int256(currentPrice.price) - int256(position.entryPrice);
        } else {
            priceDiff = int256(position.entryPrice) - int256(currentPrice.price);
        }

        // PnL = (price_diff / entry_price) * position_size
        return (priceDiff * int256(position.size)) / int256(position.entryPrice);
    }

    function getMarginRatio(bytes32 positionId) external view returns (uint256) {
        return riskManager.calculateMarginRatio(positionId);
    }

    function getFundingPayment(bytes32 positionId) public view returns (int256) {
        Position memory position = positions[positionId];
        if (position.trader == address(0)) return 0;

        string memory symbol = _getSymbolFromPosition(positionId);
        uint256 currentFundingIndex = cumulativeFundingRates[symbol];
        uint256 fundingDiff = currentFundingIndex - position.fundingIndex;
        
        int256 payment = int256(fundingDiff * position.size) / int256(BASIS_POINTS);
        return position.isLong ? -payment : payment;
    }

    // Admin functions
    function addMarket(
        string calldata symbol,
        uint256 maxLeverage
    ) external onlyOwner {
        markets[symbol] = Market({
            symbol: symbol,
            maxLeverage: maxLeverage,
            fundingRate: 0,
            lastFundingTime: block.timestamp,
            openInterestLong: 0,
            openInterestShort: 0,
            isActive: true
        });
    }

    function setMarketActive(string calldata symbol, bool active) external onlyOwner {
        markets[symbol].isActive = active;
    }

    // Internal functions
    function _getSymbolFromPosition(bytes32 positionId) internal view returns (string memory) {
        // This is a simplified implementation
        // In practice, you'd store the symbol with the position or have a mapping
        return "ETH/USD"; // Placeholder
    }
}
