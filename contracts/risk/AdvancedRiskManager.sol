// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IRiskManager.sol";
import "../interfaces/IDerivativesEngine.sol";
import "../interfaces/IPriceOracle.sol";

/**
 * @title AdvancedRiskManager
 * @dev Enhanced risk management system with liquidator incentives and insurance fund
 */
contract AdvancedRiskManager is IRiskManager, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Enhanced risk parameters
    struct EnhancedRiskParameters {
        uint256 initialMarginRatio;      // Initial margin requirement
        uint256 maintenanceMarginRatio;  // Maintenance margin requirement
        uint256 liquidationFeeRatio;     // Fee paid to liquidators
        uint256 insuranceFeeRatio;       // Fee paid to insurance fund
        uint256 maxLeverage;             // Maximum allowed leverage
        uint256 maxPositionSize;         // Maximum position size
        uint256 liquidationThreshold;    // Threshold for partial liquidation
        uint256 maxLiquidationRatio;     // Maximum % of position to liquidate at once
    }

    struct LiquidatorInfo {
        uint256 totalLiquidations;
        uint256 totalRewards;
        uint256 successRate;
        bool isActive;
        uint256 lastLiquidationTime;
    }

    struct InsuranceFund {
        uint256 totalFunds;
        uint256 totalClaims;
        uint256 reserveRatio;
        bool isActive;
    }

    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant PRICE_PRECISION = 1e18;
    uint256 public constant MIN_LIQUIDATION_REWARD = 10 * 1e18; // $10 minimum
    uint256 public constant MAX_LIQUIDATION_REWARD = 1000 * 1e18; // $1000 maximum
    uint256 public constant INSURANCE_RESERVE_TARGET = 2000; // 20% reserve ratio

    // State variables
    IDerivativesEngine public derivativesEngine;
    IPriceOracle public priceOracle;
    IERC20 public collateralToken;
    
    mapping(string => EnhancedRiskParameters) public riskParameters;
    mapping(address => LiquidatorInfo) public liquidators;
    mapping(bytes32 => uint256) public positionLastCheck;
    mapping(address => uint256) public traderRiskScore;
    
    InsuranceFund public insuranceFund;
    address[] public activeLiquidators;
    
    // Default enhanced risk parameters
    EnhancedRiskParameters public defaultRiskParams = EnhancedRiskParameters({
        initialMarginRatio: 1000,        // 10%
        maintenanceMarginRatio: 600,     // 6%
        liquidationFeeRatio: 100,        // 1%
        insuranceFeeRatio: 50,           // 0.5%
        maxLeverage: 10,                 // 10x
        maxPositionSize: 1000000 * PRICE_PRECISION, // $1M
        liquidationThreshold: 500,       // 5% - trigger partial liquidation
        maxLiquidationRatio: 5000        // 50% - max liquidation per transaction
    });

    // Events
    event LiquidatorRegistered(address indexed liquidator);
    event LiquidatorDeactivated(address indexed liquidator);
    event PartialLiquidation(bytes32 indexed positionId, uint256 liquidatedSize, uint256 remainingSize);
    event InsuranceFundContribution(uint256 amount, uint256 newTotal);
    event InsuranceFundClaim(bytes32 indexed positionId, uint256 amount);
    event RiskScoreUpdated(address indexed trader, uint256 newScore);

    constructor(
        address _derivativesEngine,
        address _priceOracle,
        address _collateralToken
    ) Ownable(msg.sender) {
        derivativesEngine = IDerivativesEngine(_derivativesEngine);
        priceOracle = IPriceOracle(_priceOracle);
        collateralToken = IERC20(_collateralToken);
        
        insuranceFund = InsuranceFund({
            totalFunds: 0,
            totalClaims: 0,
            reserveRatio: 0,
            isActive: true
        });
    }

    /**
     * @dev Registers a new liquidator
     */
    function registerLiquidator() external {
        require(!liquidators[msg.sender].isActive, "Already registered");
        
        liquidators[msg.sender] = LiquidatorInfo({
            totalLiquidations: 0,
            totalRewards: 0,
            successRate: 10000, // Start with 100% success rate
            isActive: true,
            lastLiquidationTime: 0
        });
        
        activeLiquidators.push(msg.sender);
        emit LiquidatorRegistered(msg.sender);
    }

    /**
     * @dev Enhanced liquidation with partial liquidation support
     */
    function liquidate(bytes32 positionId) external nonReentrant returns (uint256 liquidationReward) {
        require(liquidators[msg.sender].isActive, "Not registered liquidator");
        require(this.checkLiquidation(positionId), "Position not liquidatable");
        
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        require(position.trader != address(0), "Position not found");
        
        string memory symbol = _getSymbolFromPosition(positionId);
        EnhancedRiskParameters memory params = _getRiskParams(symbol);
        
        uint256 marginRatio = calculateMarginRatio(positionId);
        
        // Determine liquidation type (partial vs full)
        bool isPartialLiquidation = marginRatio > params.liquidationThreshold && marginRatio < params.maintenanceMarginRatio;
        
        uint256 liquidationSize;
        if (isPartialLiquidation) {
            // Partial liquidation - liquidate enough to restore health
            liquidationSize = _calculatePartialLiquidationSize(positionId, params);
        } else {
            // Full liquidation
            liquidationSize = position.size;
        }
        
        // Calculate liquidation reward with bonuses
        liquidationReward = _calculateLiquidationReward(position, liquidationSize, params, msg.sender);
        
        // Update liquidator stats
        _updateLiquidatorStats(msg.sender, liquidationReward, true);
        
        // Contribute to insurance fund
        uint256 insuranceContribution = (liquidationSize * params.insuranceFeeRatio) / BASIS_POINTS;
        if (insuranceContribution > 0) {
            insuranceFund.totalFunds += insuranceContribution;
            emit InsuranceFundContribution(insuranceContribution, insuranceFund.totalFunds);
        }
        
        // Update trader risk score
        _updateTraderRiskScore(position.trader, false);
        
        // Record liquidation
        positionLastCheck[positionId] = block.timestamp;
        
        if (isPartialLiquidation) {
            emit PartialLiquidation(positionId, liquidationSize, position.size - liquidationSize);
        }
        
        emit LiquidationTriggered(
            positionId,
            msg.sender,
            priceOracle.getPrice(symbol).price,
            liquidationReward
        );
        
        return liquidationReward;
    }

    /**
     * @dev Checks if position can be liquidated with enhanced criteria
     */
    function checkLiquidation(bytes32 positionId) external view returns (bool canLiquidate) {
        uint256 marginRatio = calculateMarginRatio(positionId);
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        
        if (position.trader == address(0)) return false;
        
        string memory symbol = _getSymbolFromPosition(positionId);
        EnhancedRiskParameters memory params = _getRiskParams(symbol);
        
        // Check for liquidation threshold (partial) or maintenance margin (full)
        return marginRatio < params.maintenanceMarginRatio;
    }

    /**
     * @dev Enhanced margin ratio calculation with funding and fees
     */
    function calculateMarginRatio(bytes32 positionId) public view returns (uint256) {
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        if (position.trader == address(0)) return 0;
        
        // Get current PnL and funding
        int256 pnl = derivativesEngine.calculatePnL(positionId);
        int256 fundingPayment = derivativesEngine.getFundingPayment(positionId);
        
        // Calculate effective collateral
        int256 effectiveCollateral = int256(position.collateral) + pnl + fundingPayment;
        
        // Account for accrued fees
        uint256 accruedFees = _calculateAccruedFees(positionId);
        effectiveCollateral -= int256(accruedFees);
        
        if (effectiveCollateral <= 0) return 0;
        
        return (uint256(effectiveCollateral) * BASIS_POINTS) / position.size;
    }

    /**
     * @dev Calculates liquidation price with enhanced precision
     */
    function calculateLiquidationPrice(bytes32 positionId) external view returns (uint256) {
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        if (position.trader == address(0)) return 0;
        
        string memory symbol = _getSymbolFromPosition(positionId);
        EnhancedRiskParameters memory params = _getRiskParams(symbol);
        
        // Get funding payments and fees
        int256 fundingPayment = derivativesEngine.getFundingPayment(positionId);
        uint256 accruedFees = _calculateAccruedFees(positionId);
        
        // Adjust collateral for funding and fees
        int256 adjustedCollateral = int256(position.collateral) + fundingPayment - int256(accruedFees);
        
        if (adjustedCollateral <= 0) return position.isLong ? 0 : type(uint256).max;
        
        uint256 collateralRatio = (uint256(adjustedCollateral) * BASIS_POINTS) / position.size;
        
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
     * @dev Enhanced position health check with risk scoring
     */
    function isPositionHealthy(bytes32 positionId) external view returns (bool) {
        uint256 marginRatio = calculateMarginRatio(positionId);
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        
        if (position.trader == address(0)) return false;
        
        string memory symbol = _getSymbolFromPosition(positionId);
        EnhancedRiskParameters memory params = _getRiskParams(symbol);
        
        // Consider trader risk score
        uint256 riskScore = traderRiskScore[position.trader];
        uint256 adjustedMaintenanceMargin = params.maintenanceMarginRatio;
        
        // Higher risk traders need higher margins
        if (riskScore > 7000) { // High risk (70%+)
            adjustedMaintenanceMargin = (adjustedMaintenanceMargin * 120) / 100; // +20%
        } else if (riskScore > 5000) { // Medium risk (50%+)
            adjustedMaintenanceMargin = (adjustedMaintenanceMargin * 110) / 100; // +10%
        }
        
        return marginRatio >= adjustedMaintenanceMargin;
    }

    /**
     * @dev Enhanced position opening validation
     */
    function canOpenPosition(
        address trader,
        string calldata symbol,
        uint256 size,
        uint256 collateral
    ) external view returns (bool) {
        EnhancedRiskParameters memory params = _getRiskParams(symbol);
        
        // Basic checks
        if (size > params.maxPositionSize) return false;
        
        uint256 leverage = size / collateral;
        if (leverage > params.maxLeverage) return false;
        
        uint256 marginRatio = (collateral * BASIS_POINTS) / size;
        if (marginRatio < params.initialMarginRatio) return false;
        
        // Risk score based checks
        uint256 riskScore = traderRiskScore[trader];
        if (riskScore > 8000 && leverage > 5) return false; // High risk traders limited to 5x
        if (riskScore > 6000 && leverage > 8) return false; // Medium risk traders limited to 8x
        
        return true;
    }

    /**
     * @dev Contributes to insurance fund
     */
    function contributeToInsuranceFund(uint256 amount) external {
        require(amount > 0, "Invalid amount");
        
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        insuranceFund.totalFunds += amount;
        
        // Update reserve ratio
        uint256 totalPositionValue = _getTotalPositionValue();
        if (totalPositionValue > 0) {
            insuranceFund.reserveRatio = (insuranceFund.totalFunds * BASIS_POINTS) / totalPositionValue;
        }
        
        emit InsuranceFundContribution(amount, insuranceFund.totalFunds);
    }

    /**
     * @dev Claims from insurance fund for bad debt
     */
    function claimInsuranceFund(bytes32 positionId, uint256 amount) external onlyOwner {
        require(insuranceFund.isActive, "Insurance fund inactive");
        require(amount <= insuranceFund.totalFunds, "Insufficient funds");
        require(_isValidInsuranceClaim(positionId, amount), "Invalid claim");

        insuranceFund.totalFunds -= amount;
        insuranceFund.totalClaims += amount;

        collateralToken.safeTransfer(msg.sender, amount);

        emit InsuranceFundClaim(positionId, amount);
    }

    /**
     * @dev Sets enhanced risk parameters for a market
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

        // Convert to enhanced parameters
        riskParameters[symbol] = EnhancedRiskParameters({
            initialMarginRatio: parameters.initialMarginRatio,
            maintenanceMarginRatio: parameters.maintenanceMarginRatio,
            liquidationFeeRatio: parameters.liquidationFeeRatio,
            insuranceFeeRatio: 50, // Default 0.5%
            maxLeverage: parameters.maxLeverage,
            maxPositionSize: parameters.maxPositionSize,
            liquidationThreshold: parameters.maintenanceMarginRatio + 100, // +1% buffer
            maxLiquidationRatio: 5000 // 50% max liquidation
        });

        emit RiskParametersUpdated(symbol, parameters);
    }

    /**
     * @dev Gets risk parameters for a market (interface compatibility)
     */
    function getRiskParameters(string calldata symbol)
        external view returns (RiskParameters memory) {
        EnhancedRiskParameters memory enhanced = _getRiskParams(symbol);

        return RiskParameters({
            initialMarginRatio: enhanced.initialMarginRatio,
            maintenanceMarginRatio: enhanced.maintenanceMarginRatio,
            liquidationFeeRatio: enhanced.liquidationFeeRatio,
            maxLeverage: enhanced.maxLeverage,
            maxPositionSize: enhanced.maxPositionSize
        });
    }

    /**
     * @dev Calculates required margin for a position
     */
    function getRequiredMargin(
        string calldata symbol,
        uint256 size,
        uint256 leverage
    ) external view returns (uint256) {
        EnhancedRiskParameters memory params = _getRiskParams(symbol);
        require(leverage <= params.maxLeverage, "Leverage too high");

        // Required margin = position size / leverage
        return size / leverage;
    }

    // Internal functions
    function _calculatePartialLiquidationSize(
        bytes32 positionId,
        EnhancedRiskParameters memory params
    ) internal view returns (uint256) {
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        
        // Calculate size needed to restore to maintenance margin + buffer
        uint256 targetMarginRatio = params.maintenanceMarginRatio + 200; // +2% buffer
        uint256 currentMarginRatio = calculateMarginRatio(positionId);
        
        if (currentMarginRatio >= targetMarginRatio) return 0;
        
        uint256 sizeDelta = (position.size * (targetMarginRatio - currentMarginRatio)) / BASIS_POINTS;
        
        // Cap at maximum liquidation ratio
        uint256 maxLiquidationSize = (position.size * params.maxLiquidationRatio) / BASIS_POINTS;
        
        return sizeDelta > maxLiquidationSize ? maxLiquidationSize : sizeDelta;
    }

    function _calculateLiquidationReward(
        IDerivativesEngine.Position memory position,
        uint256 liquidationSize,
        EnhancedRiskParameters memory params,
        address liquidator
    ) internal view returns (uint256) {
        // Base reward
        uint256 baseReward = (liquidationSize * params.liquidationFeeRatio) / BASIS_POINTS;
        
        // Performance bonus for good liquidators
        LiquidatorInfo memory liquidatorInfo = liquidators[liquidator];
        uint256 performanceMultiplier = BASIS_POINTS;
        
        if (liquidatorInfo.successRate > 9500) { // >95% success rate
            performanceMultiplier = 11000; // +10% bonus
        } else if (liquidatorInfo.successRate > 9000) { // >90% success rate
            performanceMultiplier = 10500; // +5% bonus
        }
        
        uint256 reward = (baseReward * performanceMultiplier) / BASIS_POINTS;
        
        // Apply min/max limits
        if (reward < MIN_LIQUIDATION_REWARD) reward = MIN_LIQUIDATION_REWARD;
        if (reward > MAX_LIQUIDATION_REWARD) reward = MAX_LIQUIDATION_REWARD;
        
        return reward;
    }

    function _updateLiquidatorStats(address liquidator, uint256 reward, bool success) internal {
        LiquidatorInfo storage info = liquidators[liquidator];
        
        info.totalLiquidations++;
        info.totalRewards += reward;
        info.lastLiquidationTime = block.timestamp;
        
        // Update success rate (exponential moving average)
        uint256 newSuccessRate = success ? 10000 : 0;
        info.successRate = (info.successRate * 9 + newSuccessRate) / 10;
    }

    function _updateTraderRiskScore(address trader, bool positive) internal {
        uint256 currentScore = traderRiskScore[trader];
        
        if (positive) {
            // Reduce risk score for good behavior
            traderRiskScore[trader] = currentScore > 100 ? currentScore - 100 : 0;
        } else {
            // Increase risk score for liquidations
            traderRiskScore[trader] = currentScore + 500; // +5%
            if (traderRiskScore[trader] > 10000) {
                traderRiskScore[trader] = 10000; // Cap at 100%
            }
        }
        
        emit RiskScoreUpdated(trader, traderRiskScore[trader]);
    }

    function _calculateAccruedFees(bytes32 positionId) internal view returns (uint256) {
        // Simplified fee calculation - in practice would include trading fees, funding fees, etc.
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        uint256 timeHeld = block.timestamp - position.entryTime;
        
        // 0.01% per day holding fee
        return (position.size * timeHeld * 1) / (BASIS_POINTS * 86400);
    }

    function _getTotalPositionValue() internal view returns (uint256) {
        // Simplified implementation - would aggregate all position values
        return 10000000 * PRICE_PRECISION; // $10M placeholder
    }

    function _isValidInsuranceClaim(bytes32 positionId, uint256 amount) internal view returns (bool) {
        // Validate that the claim is for legitimate bad debt
        IDerivativesEngine.Position memory position = derivativesEngine.getPosition(positionId);
        return position.trader != address(0) && amount <= position.collateral;
    }

    function _getRiskParams(string memory symbol) internal view returns (EnhancedRiskParameters memory) {
        if (riskParameters[symbol].maxLeverage > 0) {
            return riskParameters[symbol];
        }
        return defaultRiskParams;
    }

    function _getSymbolFromPosition(bytes32 positionId) internal pure returns (string memory) {
        return "ETH/USD"; // Simplified implementation
    }
}
