// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MaliciousReentrant
 * @dev Contract designed to test reentrancy vulnerabilities
 * Used only for security testing purposes
 */
contract MaliciousReentrant {
    address public target;
    bool public attacking;
    uint256 public attackCount;
    bytes32 public storedPositionId;
    
    event AttackAttempted(address target, string functionName);
    event AttackFailed(string reason);
    
    modifier onlyWhenNotAttacking() {
        require(!attacking, "Already attacking");
        _;
    }
    
    /**
     * @dev Attempt reentrancy attack on target contract
     */
    function attemptReentrancy(
        address _target,
        string memory functionName,
        bytes memory data
    ) external onlyWhenNotAttacking {
        target = _target;
        attacking = true;
        attackCount = 0;
        
        emit AttackAttempted(_target, functionName);
        
        try {
            (bool success,) = _target.call(data);
            if (!success) {
                emit AttackFailed("Initial call failed");
            }
        } catch Error(string memory reason) {
            emit AttackFailed(reason);
        } catch {
            emit AttackFailed("Unknown error");
        }
        
        attacking = false;
    }
    
    /**
     * @dev Setup a position for testing position-related attacks
     */
    function setupPosition(address derivativesEngine) external {
        // Approve USDC spending
        IERC20 usdc = IERC20(getUSDCAddress(derivativesEngine));
        usdc.approve(derivativesEngine, type(uint256).max);
        
        // Open a position
        try {
            (bool success, bytes memory data) = derivativesEngine.call(
                abi.encodeWithSignature(
                    "openPosition(string,uint256,uint256,bool,uint256)",
                    "ETH/USD",
                    1000 ether,
                    100 ether,
                    true,
                    50
                )
            );
            
            if (success) {
                // Extract position ID from return data or events
                storedPositionId = bytes32(data);
            }
        } catch {
            // Position creation failed
        }
    }
    
    /**
     * @dev Attempt reentrancy on position closing
     */
    function attemptReentrancyClose(address derivativesEngine) external {
        require(storedPositionId != bytes32(0), "No position to close");
        
        target = derivativesEngine;
        attacking = true;
        attackCount = 0;
        
        try {
            (bool success,) = derivativesEngine.call(
                abi.encodeWithSignature(
                    "closePosition(bytes32,uint256)",
                    storedPositionId,
                    50
                )
            );
            
            if (!success) {
                emit AttackFailed("Close position failed");
            }
        } catch Error(string memory reason) {
            emit AttackFailed(reason);
        }
        
        attacking = false;
    }
    
    /**
     * @dev Attempt reentrancy on liquidation
     */
    function attemptLiquidationReentrancy(address riskManager) external {
        target = riskManager;
        attacking = true;
        attackCount = 0;
        
        try {
            (bool success,) = riskManager.call(
                abi.encodeWithSignature(
                    "liquidate(bytes32)",
                    storedPositionId
                )
            );
            
            if (!success) {
                emit AttackFailed("Liquidation failed");
            }
        } catch Error(string memory reason) {
            emit AttackFailed(reason);
        }
        
        attacking = false;
    }
    
    /**
     * @dev Fallback function that attempts reentrancy
     */
    receive() external payable {
        if (attacking && attackCount < 3) {
            attackCount++;
            
            // Attempt to call the target again
            try {
                (bool success,) = target.call(
                    abi.encodeWithSignature("openPosition(string,uint256,uint256,bool,uint256)",
                        "ETH/USD",
                        1000 ether,
                        100 ether,
                        true,
                        50
                    )
                );
                
                if (!success) {
                    emit AttackFailed("Reentrancy call failed");
                }
            } catch {
                emit AttackFailed("Reentrancy exception");
            }
        }
    }
    
    /**
     * @dev ERC20 transfer hook for reentrancy attempts
     */
    function onTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) external {
        if (attacking && attackCount < 3) {
            attackCount++;
            
            // Attempt reentrancy during token transfer
            try {
                (bool success,) = target.call(
                    abi.encodeWithSignature("closePosition(bytes32,uint256)",
                        storedPositionId,
                        50
                    )
                );
                
                if (!success) {
                    emit AttackFailed("Token transfer reentrancy failed");
                }
            } catch {
                emit AttackFailed("Token transfer reentrancy exception");
            }
        }
    }
    
    /**
     * @dev Helper to get USDC address from derivatives engine
     */
    function getUSDCAddress(address derivativesEngine) internal view returns (address) {
        try {
            (bool success, bytes memory data) = derivativesEngine.staticcall(
                abi.encodeWithSignature("collateralToken()")
            );
            
            if (success) {
                return abi.decode(data, (address));
            }
        } catch {
            // Fallback to zero address
        }
        
        return address(0);
    }
    
    /**
     * @dev Emergency function to withdraw any tokens
     */
    function emergencyWithdraw(address token) external {
        if (token == address(0)) {
            payable(msg.sender).transfer(address(this).balance);
        } else {
            IERC20(token).transfer(msg.sender, IERC20(token).balanceOf(address(this)));
        }
    }
}

/**
 * @title FlashLoanAttacker
 * @dev Contract to test flash loan attack vulnerabilities
 */
contract FlashLoanAttacker {
    bool private attacking;
    uint256 private flashLoanAmount;
    address private targetContract;
    address private tokenAddress;
    
    event FlashLoanAttackStarted(uint256 amount);
    event FlashLoanAttackCompleted(bool success);
    
    /**
     * @dev Execute flash loan attack
     */
    function executeFlashLoanAttack(
        address _target,
        address _token,
        uint256 _amount
    ) external {
        require(!attacking, "Attack in progress");
        
        attacking = true;
        flashLoanAmount = _amount;
        targetContract = _target;
        tokenAddress = _token;
        
        emit FlashLoanAttackStarted(_amount);
        
        // Simulate flash loan
        IERC20 token = IERC20(_token);
        uint256 initialBalance = token.balanceOf(address(this));
        
        // Step 1: Use flash loaned funds to manipulate market
        try {
            // Approve spending
            token.approve(_target, _amount);
            
            // Open large position to manipulate funding rates
            (bool success1,) = _target.call(
                abi.encodeWithSignature(
                    "openPosition(string,uint256,uint256,bool,uint256)",
                    "ETH/USD",
                    _amount,
                    _amount / 10, // 10x leverage
                    true,
                    50
                )
            );
            
            // Step 2: Try to profit from manipulation
            if (success1) {
                // Attempt to close position at manipulated price
                (bool success2,) = _target.call(
                    abi.encodeWithSignature("updateFundingRate(string)", "ETH/USD")
                );
                
                if (!success2) {
                    revert("Flash loan attack detected");
                }
            }
            
        } catch Error(string memory reason) {
            attacking = false;
            revert(reason);
        }
        
        // Step 3: Repay flash loan
        uint256 finalBalance = token.balanceOf(address(this));
        require(finalBalance >= initialBalance, "Flash loan attack failed");
        
        attacking = false;
        emit FlashLoanAttackCompleted(true);
    }
    
    /**
     * @dev Simulate flash loan callback
     */
    function onFlashLoan(
        address initiator,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32) {
        // This would be called by a flash loan provider
        // Implement attack logic here
        
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}

/**
 * @title MaliciousOracle
 * @dev Contract to test oracle manipulation vulnerabilities
 */
contract MaliciousOracle {
    mapping(string => uint256) private prices;
    mapping(string => uint256) private confidences;
    bool private manipulating;
    
    event PriceManipulated(string symbol, uint256 oldPrice, uint256 newPrice);
    
    function setPrice(string memory symbol, uint256 price, uint256 confidence) external {
        prices[symbol] = price;
        confidences[symbol] = confidence;
    }
    
    function getPrice(string memory symbol) external view returns (uint256 price, uint256 confidence) {
        return (prices[symbol], confidences[symbol]);
    }
    
    /**
     * @dev Manipulate price for attack
     */
    function manipulatePrice(string memory symbol, uint256 newPrice) external {
        uint256 oldPrice = prices[symbol];
        prices[symbol] = newPrice;
        manipulating = true;
        
        emit PriceManipulated(symbol, oldPrice, newPrice);
    }
    
    /**
     * @dev Return to normal price
     */
    function restorePrice(string memory symbol, uint256 normalPrice) external {
        prices[symbol] = normalPrice;
        manipulating = false;
    }
    
    function isManipulating() external view returns (bool) {
        return manipulating;
    }
}

/**
 * @title GasGriefingAttacker
 * @dev Contract to test gas griefing attacks
 */
contract GasGriefingAttacker {
    uint256[] private wasteGas;
    
    /**
     * @dev Consume excessive gas to grief other transactions
     */
    function griefGas() external {
        // Consume gas by writing to storage
        for (uint256 i = 0; i < 1000; i++) {
            wasteGas.push(i);
        }
    }
    
    /**
     * @dev Fallback that consumes gas
     */
    receive() external payable {
        // Consume gas in receive function
        for (uint256 i = 0; i < 100; i++) {
            wasteGas.push(i);
        }
    }
    
    /**
     * @dev Function that reverts after consuming gas
     */
    function consumeGasAndRevert() external {
        for (uint256 i = 0; i < 500; i++) {
            wasteGas.push(i);
        }
        revert("Gas consumed and reverted");
    }
}
