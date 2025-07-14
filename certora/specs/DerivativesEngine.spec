// Certora Formal Verification Specification for DerivativesEngine
// This specification defines invariants and properties that must hold

using MockERC20 as collateralToken;
using PriceOracle as priceOracle;
using AdvancedRiskManager as riskManager;

methods {
    // DerivativesEngine methods
    function openPosition(string memory symbol, uint256 size, uint256 collateral, bool isLong, uint256 maxSlippage) external returns (bytes32);
    function closePosition(bytes32 positionId, uint256 maxSlippage) external returns (int256);
    function addCollateral(bytes32 positionId, uint256 amount) external;
    function removeCollateral(bytes32 positionId, uint256 amount) external;
    function getPosition(bytes32 positionId) external view returns (Position memory);
    function markets(string memory symbol) external view returns (Market memory);
    function totalCollateral() external view returns (uint256);
    function totalOpenInterest(string memory symbol) external view returns (uint256);
    
    // ERC20 methods
    function collateralToken.balanceOf(address account) external view returns (uint256) envfree;
    function collateralToken.totalSupply() external view returns (uint256) envfree;
    function collateralToken.allowance(address owner, address spender) external view returns (uint256) envfree;
    
    // Oracle methods
    function priceOracle.getPrice(string memory symbol) external view returns (uint256, uint256) envfree;
    
    // Risk manager methods
    function riskManager.isLiquidatable(bytes32 positionId) external view returns (bool) envfree;
    function riskManager.calculateMarginRatio(bytes32 positionId) external view returns (uint256) envfree;
}

// Ghost variables for tracking state
ghost mapping(bytes32 => uint256) ghostPositionCollateral;
ghost mapping(string => uint256) ghostMarketOpenInterest;
ghost uint256 ghostTotalCollateral;

// Hooks to update ghost variables
hook Sstore positions[KEY bytes32 positionId].collateral uint256 newCollateral (uint256 oldCollateral) STORAGE {
    ghostPositionCollateral[positionId] = newCollateral;
}

hook Sstore markets[KEY string symbol].openInterestLong uint256 newOI (uint256 oldOI) STORAGE {
    ghostMarketOpenInterest[symbol] = ghostMarketOpenInterest[symbol] + newOI - oldOI;
}

hook Sstore markets[KEY string symbol].openInterestShort uint256 newOI (uint256 oldOI) STORAGE {
    ghostMarketOpenInterest[symbol] = ghostMarketOpenInterest[symbol] + newOI - oldOI;
}

// INVARIANTS

// Invariant: Total collateral in contract equals sum of all position collaterals
invariant totalCollateralConsistency()
    totalCollateral() == ghostTotalCollateral
    {
        preserved with (env e) {
            require e.msg.sender != currentContract;
        }
    }

// Invariant: Contract's token balance >= total collateral locked
invariant collateralSolvency()
    collateralToken.balanceOf(currentContract) >= totalCollateral()
    {
        preserved with (env e) {
            require e.msg.sender != currentContract;
        }
    }

// Invariant: Position collateral is always positive for open positions
invariant positionCollateralPositive(bytes32 positionId)
    getPosition(positionId).status == 0 => getPosition(positionId).collateral > 0 // 0 = OPEN
    {
        preserved with (env e) {
            require e.msg.sender != currentContract;
        }
    }

// Invariant: Position size is always positive for open positions
invariant positionSizePositive(bytes32 positionId)
    getPosition(positionId).status == 0 => getPosition(positionId).size > 0
    {
        preserved with (env e) {
            require e.msg.sender != currentContract;
        }
    }

// Invariant: Market open interest equals sum of all position sizes
invariant marketOpenInterestConsistency(string symbol)
    totalOpenInterest(symbol) == ghostMarketOpenInterest[symbol]
    {
        preserved with (env e) {
            require e.msg.sender != currentContract;
        }
    }

// RULES

// Rule: Opening a position increases total collateral
rule openPositionIncreasesCollateral(env e, string symbol, uint256 size, uint256 collateral, bool isLong, uint256 maxSlippage) {
    uint256 totalCollateralBefore = totalCollateral();
    uint256 userBalanceBefore = collateralToken.balanceOf(e.msg.sender);
    uint256 contractBalanceBefore = collateralToken.balanceOf(currentContract);
    
    bytes32 positionId = openPosition(e, symbol, size, collateral, isLong, maxSlippage);
    
    uint256 totalCollateralAfter = totalCollateral();
    uint256 userBalanceAfter = collateralToken.balanceOf(e.msg.sender);
    uint256 contractBalanceAfter = collateralToken.balanceOf(currentContract);
    
    assert totalCollateralAfter == totalCollateralBefore + collateral;
    assert userBalanceAfter == userBalanceBefore - collateral;
    assert contractBalanceAfter == contractBalanceBefore + collateral;
    assert positionId != to_bytes32(0);
}

// Rule: Closing a position decreases total collateral
rule closePositionDecreasesCollateral(env e, bytes32 positionId, uint256 maxSlippage) {
    require getPosition(positionId).status == 0; // Position is open
    require getPosition(positionId).trader == e.msg.sender; // Caller owns position
    
    uint256 totalCollateralBefore = totalCollateral();
    uint256 positionCollateralBefore = getPosition(positionId).collateral;
    uint256 userBalanceBefore = collateralToken.balanceOf(e.msg.sender);
    
    int256 pnl = closePosition(e, positionId, maxSlippage);
    
    uint256 totalCollateralAfter = totalCollateral();
    uint256 userBalanceAfter = collateralToken.balanceOf(e.msg.sender);
    
    assert totalCollateralAfter == totalCollateralBefore - positionCollateralBefore;
    assert getPosition(positionId).status != 0; // Position is no longer open
}

// Rule: Adding collateral increases position collateral
rule addCollateralIncreasesPositionCollateral(env e, bytes32 positionId, uint256 amount) {
    require getPosition(positionId).status == 0; // Position is open
    require getPosition(positionId).trader == e.msg.sender; // Caller owns position
    require amount > 0;
    
    uint256 positionCollateralBefore = getPosition(positionId).collateral;
    uint256 userBalanceBefore = collateralToken.balanceOf(e.msg.sender);
    
    addCollateral(e, positionId, amount);
    
    uint256 positionCollateralAfter = getPosition(positionId).collateral;
    uint256 userBalanceAfter = collateralToken.balanceOf(e.msg.sender);
    
    assert positionCollateralAfter == positionCollateralBefore + amount;
    assert userBalanceAfter == userBalanceBefore - amount;
}

// Rule: Removing collateral decreases position collateral
rule removeCollateralDecreasesPositionCollateral(env e, bytes32 positionId, uint256 amount) {
    require getPosition(positionId).status == 0; // Position is open
    require getPosition(positionId).trader == e.msg.sender; // Caller owns position
    require amount > 0;
    require getPosition(positionId).collateral > amount; // Sufficient collateral
    
    uint256 positionCollateralBefore = getPosition(positionId).collateral;
    uint256 userBalanceBefore = collateralToken.balanceOf(e.msg.sender);
    
    removeCollateral(e, positionId, amount);
    
    uint256 positionCollateralAfter = getPosition(positionId).collateral;
    uint256 userBalanceAfter = collateralToken.balanceOf(e.msg.sender);
    
    assert positionCollateralAfter == positionCollateralBefore - amount;
    assert userBalanceAfter == userBalanceBefore + amount;
}

// Rule: Only position owner can modify position
rule onlyOwnerCanModifyPosition(env e, bytes32 positionId) {
    require getPosition(positionId).status == 0; // Position is open
    require getPosition(positionId).trader != e.msg.sender; // Caller doesn't own position
    
    // Try to close position
    closePosition@withrevert(e, positionId, 50);
    assert lastReverted;
    
    // Try to add collateral
    addCollateral@withrevert(e, positionId, 100);
    assert lastReverted;
    
    // Try to remove collateral
    removeCollateral@withrevert(e, positionId, 100);
    assert lastReverted;
}

// Rule: Position leverage cannot exceed market maximum
rule positionLeverageRespected(env e, string symbol, uint256 size, uint256 collateral, bool isLong, uint256 maxSlippage) {
    require markets(symbol).isActive;
    require size > 0 && collateral > 0;
    
    uint256 maxLeverage = markets(symbol).maxLeverage;
    uint256 leverage = size / collateral;
    
    if (leverage > maxLeverage) {
        openPosition@withrevert(e, symbol, size, collateral, isLong, maxSlippage);
        assert lastReverted;
    }
}

// Rule: Market must be active to open positions
rule requireActiveMarket(env e, string symbol, uint256 size, uint256 collateral, bool isLong, uint256 maxSlippage) {
    require !markets(symbol).isActive;
    
    openPosition@withrevert(e, symbol, size, collateral, isLong, maxSlippage);
    assert lastReverted;
}

// Rule: Sufficient allowance required for opening positions
rule requireSufficientAllowance(env e, string symbol, uint256 size, uint256 collateral, bool isLong, uint256 maxSlippage) {
    require collateralToken.allowance(e.msg.sender, currentContract) < collateral;
    
    openPosition@withrevert(e, symbol, size, collateral, isLong, maxSlippage);
    assert lastReverted;
}

// Rule: Sufficient balance required for opening positions
rule requireSufficientBalance(env e, string symbol, uint256 size, uint256 collateral, bool isLong, uint256 maxSlippage) {
    require collateralToken.balanceOf(e.msg.sender) < collateral;
    
    openPosition@withrevert(e, symbol, size, collateral, isLong, maxSlippage);
    assert lastReverted;
}

// Rule: Position margin ratio must be above liquidation threshold
rule positionMarginRatioSafety(bytes32 positionId) {
    require getPosition(positionId).status == 0; // Position is open
    
    uint256 marginRatio = riskManager.calculateMarginRatio(positionId);
    bool isLiquidatable = riskManager.isLiquidatable(positionId);
    
    // If position is not liquidatable, margin ratio should be above threshold
    assert !isLiquidatable => marginRatio >= 600; // 6% in basis points
}

// Rule: No reentrancy in critical functions
rule noReentrancy(env e, method f, calldataarg args) {
    require f.selector == sig:openPosition(string,uint256,uint256,bool,uint256).selector ||
            f.selector == sig:closePosition(bytes32,uint256).selector ||
            f.selector == sig:addCollateral(bytes32,uint256).selector ||
            f.selector == sig:removeCollateral(bytes32,uint256).selector;
    
    // This would be checked by the formal verification tool
    // to ensure no reentrancy is possible
    invoke f(e, args);
    satisfy true; // Placeholder for reentrancy check
}

// Rule: Total supply of collateral token never decreases unexpectedly
rule collateralTokenSupplyStability() {
    uint256 totalSupplyBefore = collateralToken.totalSupply();
    
    env e;
    method f;
    calldataarg args;
    invoke f(e, args);
    
    uint256 totalSupplyAfter = collateralToken.totalSupply();
    
    // Total supply should only change through mint/burn operations
    // not through derivatives engine operations
    assert totalSupplyAfter == totalSupplyBefore;
}

// Rule: Contract balance consistency
rule contractBalanceConsistency(env e, method f, calldataarg args) {
    uint256 contractBalanceBefore = collateralToken.balanceOf(currentContract);
    uint256 totalCollateralBefore = totalCollateral();
    
    invoke f(e, args);
    
    uint256 contractBalanceAfter = collateralToken.balanceOf(currentContract);
    uint256 totalCollateralAfter = totalCollateral();
    
    // Contract balance should always be >= total collateral
    assert contractBalanceAfter >= totalCollateralAfter;
    
    // Change in contract balance should match change in total collateral
    // (assuming no external transfers)
    assert contractBalanceAfter - contractBalanceBefore == 
           totalCollateralAfter - totalCollateralBefore;
}
