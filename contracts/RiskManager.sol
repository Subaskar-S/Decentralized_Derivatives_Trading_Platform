// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IRiskManager.sol";
import "./interfaces/IDerivativesEngine.sol";
import "./interfaces/IPriceOracle.sol";

/**
 * @title RiskManager
 * @dev Risk management and liquidation system for derivatives trading
 */
contract RiskManager is IRiskManager, Ownable {
    
    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant LIQUIDATION_REWARD_RATIO = 50; // 0.5% of position size
    uint256 public constant PRICE_PRECISION = 1e18;

    // State variables
    IDerivativesEngine public derivativesEngine;
    IPriceOracle public priceOracle;
    
    mapping(string => RiskParameters) public riskParameters;
    mapping(address => uint256) public traderPositionCount;
    mapping(address => uint256) public traderTotalCollateral;

    // Default risk parameters
    RiskParameters public defaultRiskParams = RiskParameters({
        initialMarginRatio: 1000,      // 10%
        maintenanceMarginRatio: 600,   // 6%
        liquidationFeeRatio: 100,      // 1%
        maxLeverage: 10,               // 10x
        maxPositionSize: 1000000 * PRICE_PRECISION // $1M
    });

    constructor(
        address _derivativesEngine,
        address _priceOracle
    ) Ownable(msg.sender) {
        derivativesEngine = IDerivativesEngine(_derivativesEngine);
        priceOracle = IPriceOracle(_priceOracle);
    }

    /**
     * @dev Checks if a position can be liquidated
     */
    function checkLiquidation(bytes32 positionId) external view returns (bool canLiquidate) {
        uint256 marginRatio = calculateMarginRatio(positionId);
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        
        if (position.trader == address(0)) return false;
        
        string memory symbol = _getSymbolFromPosition(positionId);
        RiskParameters memory params = _getRiskParams(symbol);
        
        return marginRatio < params.maintenanceMarginRatio;
    }

    /**
     * @dev Liquidates a position and returns liquidation reward
     */
    function liquidate(bytes32 positionId) external returns (uint256 liquidationReward) {
        require(this.checkLiquidation(positionId), "Position not liquidatable");
        
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        require(position.trader != address(0), "Position not found");
        
        string memory symbol = _getSymbolFromPosition(positionId);
        RiskParameters memory params = _getRiskParams(symbol);
        
        // Calculate liquidation reward
        liquidationReward = (position.size * LIQUIDATION_REWARD_RATIO) / BASIS_POINTS;
        
        // Ensure liquidation reward doesn't exceed available collateral
        if (liquidationReward > position.collateral) {
            liquidationReward = position.collateral;
        }
        
        // Get current price for liquidation
        IPriceOracle.PriceData memory priceData = priceOracle.getPrice(symbol);
        require(priceData.isValid, "Invalid price for liquidation");
        
        emit LiquidationTriggered(
            positionId,
            msg.sender,
            priceData.price,
            liquidationReward
        );
        
        // Update trader statistics
        traderPositionCount[position.trader]--;
        traderTotalCollateral[position.trader] -= position.collateral;
        
        return liquidationReward;
    }

    /**
     * @dev Calculates the margin ratio for a position
     */
    function calculateMarginRatio(bytes32 positionId) public view returns (uint256) {
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        if (position.trader == address(0)) return 0;
        
        // Get current PnL
        int256 pnl = derivativesEngine.calculatePnL(positionId);
        int256 fundingPayment = derivativesEngine.getFundingPayment(positionId);
        
        // Calculate effective collateral (collateral + PnL + funding)
        int256 effectiveCollateral = int256(position.collateral) + pnl + fundingPayment;
        
        // If effective collateral is negative or zero, margin ratio is 0
        if (effectiveCollateral <= 0) return 0;
        
        // Margin ratio = (effective collateral / position size) * 10000 (basis points)
        return (uint256(effectiveCollateral) * BASIS_POINTS) / position.size;
    }

    /**
     * @dev Calculates the liquidation price for a position
     */
    function calculateLiquidationPrice(bytes32 positionId) external view returns (uint256) {
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        if (position.trader == address(0)) return 0;
        
        string memory symbol = _getSymbolFromPosition(positionId);
        RiskParameters memory params = _getRiskParams(symbol);
        
        // Calculate the price at which margin ratio equals maintenance margin ratio
        // For long: liquidation_price = entry_price * (1 - (collateral/size - maintenance_margin))
        // For short: liquidation_price = entry_price * (1 + (collateral/size - maintenance_margin))
        
        uint256 collateralRatio = (position.collateral * BASIS_POINTS) / position.size;
        
        if (position.isLong) {
            if (collateralRatio <= params.maintenanceMarginRatio) return 0;
            uint256 priceDropRatio = collateralRatio - params.maintenanceMarginRatio;
            return (position.entryPrice * (BASIS_POINTS - priceDropRatio)) / BASIS_POINTS;
        } else {
            uint256 priceRiseRatio = collateralRatio - params.maintenanceMarginRatio;
            return (position.entryPrice * (BASIS_POINTS + priceRiseRatio)) / BASIS_POINTS;
        }
    }

    /**
     * @dev Sets risk parameters for a specific market
     */
    function setRiskParameters(
        string calldata symbol,
        RiskParameters calldata parameters
    ) external onlyOwner {
        require(parameters.initialMarginRatio > parameters.maintenanceMarginRatio, 
                "Initial margin must be > maintenance margin");
        require(parameters.maintenanceMarginRatio > 0, "Maintenance margin must be > 0");
        require(parameters.maxLeverage > 0, "Max leverage must be > 0");
        require(parameters.maxPositionSize > 0, "Max position size must be > 0");
        
        riskParameters[symbol] = parameters;
        
        emit RiskParametersUpdated(symbol, parameters);
    }

    /**
     * @dev Gets risk parameters for a market
     */
    function getRiskParameters(string calldata symbol) 
        external view returns (RiskParameters memory) {
        return _getRiskParams(symbol);
    }

    /**
     * @dev Checks if a position is healthy (above maintenance margin)
     */
    function isPositionHealthy(bytes32 positionId) external view returns (bool) {
        uint256 marginRatio = calculateMarginRatio(positionId);
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        
        if (position.trader == address(0)) return false;
        
        string memory symbol = _getSymbolFromPosition(positionId);
        RiskParameters memory params = _getRiskParams(symbol);
        
        return marginRatio >= params.maintenanceMarginRatio;
    }

    /**
     * @dev Calculates required margin for a position
     */
    function getRequiredMargin(
        string calldata symbol,
        uint256 size,
        uint256 leverage
    ) external view returns (uint256) {
        RiskParameters memory params = _getRiskParams(symbol);
        require(leverage <= params.maxLeverage, "Leverage too high");
        
        // Required margin = position size / leverage
        return size / leverage;
    }

    /**
     * @dev Checks if a trader can open a new position
     */
    function canOpenPosition(
        address trader,
        string calldata symbol,
        uint256 size,
        uint256 collateral
    ) external view returns (bool) {
        RiskParameters memory params = _getRiskParams(symbol);
        
        // Check position size limit
        if (size > params.maxPositionSize) return false;
        
        // Check leverage limit
        uint256 leverage = size / collateral;
        if (leverage > params.maxLeverage) return false;
        
        // Check initial margin requirement
        uint256 marginRatio = (collateral * BASIS_POINTS) / size;
        if (marginRatio < params.initialMarginRatio) return false;
        
        // Additional checks can be added here (e.g., trader limits, global limits)
        
        return true;
    }

    /**
     * @dev Emergency function to trigger margin call
     */
    function triggerMarginCall(bytes32 positionId) external {
        uint256 marginRatio = calculateMarginRatio(positionId);
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        
        require(position.trader != address(0), "Position not found");
        
        string memory symbol = _getSymbolFromPosition(positionId);
        RiskParameters memory params = _getRiskParams(symbol);
        
        // Trigger margin call if below initial margin but above maintenance margin
        if (marginRatio < params.initialMarginRatio && marginRatio >= params.maintenanceMarginRatio) {
            emit MarginCall(positionId, marginRatio, params.maintenanceMarginRatio);
        }
    }

    /**
     * @dev Updates trader statistics when position is opened
     */
    function onPositionOpened(
        address trader,
        uint256 collateral
    ) external {
        require(msg.sender == address(derivativesEngine), "Only derivatives engine");
        
        traderPositionCount[trader]++;
        traderTotalCollateral[trader] += collateral;
    }

    /**
     * @dev Updates trader statistics when position is closed
     */
    function onPositionClosed(
        address trader,
        uint256 collateral
    ) external {
        require(msg.sender == address(derivativesEngine), "Only derivatives engine");
        
        traderPositionCount[trader]--;
        traderTotalCollateral[trader] -= collateral;
    }

    // Internal functions
    function _getRiskParams(string memory symbol) internal view returns (RiskParameters memory) {
        // Return symbol-specific params if they exist, otherwise return default
        if (riskParameters[symbol].maxLeverage > 0) {
            return riskParameters[symbol];
        }
        return defaultRiskParams;
    }

    function _getSymbolFromPosition(bytes32 positionId) internal pure returns (string memory) {
        // Simplified implementation - in practice, this would be stored with the position
        return "ETH/USD";
    }

    // Admin functions
    function setDerivativesEngine(address _derivativesEngine) external onlyOwner {
        derivativesEngine = IDerivativesEngine(_derivativesEngine);
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        priceOracle = IPriceOracle(_priceOracle);
    }

    function setDefaultRiskParameters(RiskParameters calldata params) external onlyOwner {
        require(params.initialMarginRatio > params.maintenanceMarginRatio, 
                "Initial margin must be > maintenance margin");
        require(params.maintenanceMarginRatio > 0, "Maintenance margin must be > 0");
        
        defaultRiskParams = params;
    }
}
