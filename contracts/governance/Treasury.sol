// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Treasury
 * @dev DAO treasury for managing protocol funds and revenue distribution
 */
contract Treasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct RevenueStream {
        address token;
        uint256 totalCollected;
        uint256 totalDistributed;
        uint256 lastDistribution;
        bool isActive;
    }

    struct Allocation {
        uint256 stakingRewards;     // % to staking rewards
        uint256 development;        // % to development fund
        uint256 marketing;          // % to marketing
        uint256 insurance;          // % to insurance fund
        uint256 buyback;           // % to token buyback
        uint256 reserve;           // % to treasury reserve
    }

    struct Grant {
        uint256 id;
        address recipient;
        uint256 amount;
        address token;
        string purpose;
        uint256 vestingDuration;
        uint256 cliffDuration;
        uint256 startTime;
        uint256 claimed;
        bool isActive;
    }

    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MAX_ALLOCATION = 10000; // 100%

    // State variables
    address public governance;
    mapping(address => RevenueStream) public revenueStreams;
    mapping(uint256 => Grant) public grants;
    
    Allocation public allocation;
    address[] public supportedTokens;
    uint256 public nextGrantId;
    
    // Allocation addresses
    address public stakingRewardsPool;
    address public developmentFund;
    address public marketingFund;
    address public insuranceFund;
    address public buybackContract;

    // Events
    event RevenueCollected(address indexed token, uint256 amount, address indexed source);
    event RevenueDistributed(address indexed token, uint256 amount, string category);
    event GrantCreated(uint256 indexed grantId, address indexed recipient, uint256 amount, address token);
    event GrantClaimed(uint256 indexed grantId, uint256 amount);
    event AllocationUpdated(Allocation newAllocation);
    event FundAddressUpdated(string category, address newAddress);

    modifier onlyGovernance() {
        require(msg.sender == governance, "Only governance");
        _;
    }

    constructor(
        address _governance,
        address _stakingRewardsPool,
        address _developmentFund,
        address _marketingFund,
        address _insuranceFund,
        address _buybackContract
    ) Ownable(msg.sender) {
        governance = _governance;
        stakingRewardsPool = _stakingRewardsPool;
        developmentFund = _developmentFund;
        marketingFund = _marketingFund;
        insuranceFund = _insuranceFund;
        buybackContract = _buybackContract;
        
        // Default allocation: 40% staking, 20% development, 15% marketing, 
        // 10% insurance, 10% buyback, 5% reserve
        allocation = Allocation({
            stakingRewards: 4000,
            development: 2000,
            marketing: 1500,
            insurance: 1000,
            buyback: 1000,
            reserve: 500
        });
    }

    /**
     * @dev Collects revenue from protocol operations
     */
    function collectRevenue(address token, uint256 amount) external {
        require(amount > 0, "Invalid amount");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        RevenueStream storage stream = revenueStreams[token];
        if (!stream.isActive) {
            stream.token = token;
            stream.isActive = true;
            supportedTokens.push(token);
        }
        
        stream.totalCollected += amount;
        
        emit RevenueCollected(token, amount, msg.sender);
    }

    /**
     * @dev Distributes collected revenue according to allocation
     */
    function distributeRevenue(address token) external nonReentrant {
        RevenueStream storage stream = revenueStreams[token];
        require(stream.isActive, "Token not supported");
        
        uint256 availableAmount = stream.totalCollected - stream.totalDistributed;
        require(availableAmount > 0, "No revenue to distribute");
        
        IERC20 tokenContract = IERC20(token);
        
        // Distribute according to allocation
        uint256 stakingAmount = (availableAmount * allocation.stakingRewards) / BASIS_POINTS;
        uint256 developmentAmount = (availableAmount * allocation.development) / BASIS_POINTS;
        uint256 marketingAmount = (availableAmount * allocation.marketing) / BASIS_POINTS;
        uint256 insuranceAmount = (availableAmount * allocation.insurance) / BASIS_POINTS;
        uint256 buybackAmount = (availableAmount * allocation.buyback) / BASIS_POINTS;
        // Reserve stays in treasury
        
        if (stakingAmount > 0 && stakingRewardsPool != address(0)) {
            tokenContract.safeTransfer(stakingRewardsPool, stakingAmount);
            emit RevenueDistributed(token, stakingAmount, "staking");
        }
        
        if (developmentAmount > 0 && developmentFund != address(0)) {
            tokenContract.safeTransfer(developmentFund, developmentAmount);
            emit RevenueDistributed(token, developmentAmount, "development");
        }
        
        if (marketingAmount > 0 && marketingFund != address(0)) {
            tokenContract.safeTransfer(marketingFund, marketingAmount);
            emit RevenueDistributed(token, marketingAmount, "marketing");
        }
        
        if (insuranceAmount > 0 && insuranceFund != address(0)) {
            tokenContract.safeTransfer(insuranceFund, insuranceAmount);
            emit RevenueDistributed(token, insuranceAmount, "insurance");
        }
        
        if (buybackAmount > 0 && buybackContract != address(0)) {
            tokenContract.safeTransfer(buybackContract, buybackAmount);
            emit RevenueDistributed(token, buybackAmount, "buyback");
        }
        
        stream.totalDistributed += availableAmount;
        stream.lastDistribution = block.timestamp;
    }

    /**
     * @dev Creates a new grant with vesting
     */
    function createGrant(
        address recipient,
        uint256 amount,
        address token,
        string calldata purpose,
        uint256 vestingDuration,
        uint256 cliffDuration
    ) external onlyGovernance returns (uint256 grantId) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient treasury balance");
        
        grantId = nextGrantId++;
        
        grants[grantId] = Grant({
            id: grantId,
            recipient: recipient,
            amount: amount,
            token: token,
            purpose: purpose,
            vestingDuration: vestingDuration,
            cliffDuration: cliffDuration,
            startTime: block.timestamp,
            claimed: 0,
            isActive: true
        });
        
        emit GrantCreated(grantId, recipient, amount, token);
        return grantId;
    }

    /**
     * @dev Claims vested grant tokens
     */
    function claimGrant(uint256 grantId) external nonReentrant {
        Grant storage grant = grants[grantId];
        require(grant.isActive, "Grant not active");
        require(grant.recipient == msg.sender, "Not grant recipient");
        
        uint256 vestedAmount = getVestedAmount(grantId);
        uint256 claimableAmount = vestedAmount - grant.claimed;
        require(claimableAmount > 0, "No tokens to claim");
        
        grant.claimed += claimableAmount;
        
        IERC20(grant.token).safeTransfer(grant.recipient, claimableAmount);
        
        emit GrantClaimed(grantId, claimableAmount);
    }

    /**
     * @dev Emergency transfer function (governance only)
     */
    function emergencyTransfer(
        address token,
        address to,
        uint256 amount
    ) external onlyGovernance {
        require(to != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @dev Updates revenue allocation percentages
     */
    function updateAllocation(Allocation calldata newAllocation) external onlyGovernance {
        uint256 total = newAllocation.stakingRewards + 
                       newAllocation.development + 
                       newAllocation.marketing + 
                       newAllocation.insurance + 
                       newAllocation.buyback + 
                       newAllocation.reserve;
        
        require(total == BASIS_POINTS, "Allocation must sum to 100%");
        
        allocation = newAllocation;
        emit AllocationUpdated(newAllocation);
    }

    /**
     * @dev Updates fund addresses
     */
    function updateFundAddress(string calldata category, address newAddress) external onlyGovernance {
        require(newAddress != address(0), "Invalid address");
        
        bytes32 categoryHash = keccak256(bytes(category));
        
        if (categoryHash == keccak256(bytes("staking"))) {
            stakingRewardsPool = newAddress;
        } else if (categoryHash == keccak256(bytes("development"))) {
            developmentFund = newAddress;
        } else if (categoryHash == keccak256(bytes("marketing"))) {
            marketingFund = newAddress;
        } else if (categoryHash == keccak256(bytes("insurance"))) {
            insuranceFund = newAddress;
        } else if (categoryHash == keccak256(bytes("buyback"))) {
            buybackContract = newAddress;
        } else {
            revert("Invalid category");
        }
        
        emit FundAddressUpdated(category, newAddress);
    }

    /**
     * @dev Calculates vested amount for a grant
     */
    function getVestedAmount(uint256 grantId) public view returns (uint256) {
        Grant memory grant = grants[grantId];
        if (!grant.isActive) return 0;
        
        uint256 elapsed = block.timestamp - grant.startTime;
        
        // No vesting before cliff
        if (elapsed < grant.cliffDuration) {
            return 0;
        }
        
        // Full vesting after duration
        if (elapsed >= grant.vestingDuration) {
            return grant.amount;
        }
        
        // Linear vesting between cliff and full duration
        return (grant.amount * elapsed) / grant.vestingDuration;
    }

    /**
     * @dev Gets treasury balance for a token
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @dev Gets revenue stream information
     */
    function getRevenueStream(address token) external view returns (
        uint256 totalCollected,
        uint256 totalDistributed,
        uint256 available,
        uint256 lastDistribution
    ) {
        RevenueStream memory stream = revenueStreams[token];
        available = stream.totalCollected - stream.totalDistributed;
        
        return (
            stream.totalCollected,
            stream.totalDistributed,
            available,
            stream.lastDistribution
        );
    }

    /**
     * @dev Gets grant information
     */
    function getGrantInfo(uint256 grantId) external view returns (
        address recipient,
        uint256 amount,
        address token,
        string memory purpose,
        uint256 vested,
        uint256 claimed,
        uint256 claimable
    ) {
        Grant memory grant = grants[grantId];
        uint256 vestedAmount = getVestedAmount(grantId);
        uint256 claimableAmount = vestedAmount - grant.claimed;
        
        return (
            grant.recipient,
            grant.amount,
            grant.token,
            grant.purpose,
            vestedAmount,
            grant.claimed,
            claimableAmount
        );
    }

    /**
     * @dev Gets supported tokens list
     */
    function getSupportedTokens() external view returns (address[] memory) {
        return supportedTokens;
    }

    /**
     * @dev Updates governance address (only owner)
     */
    function setGovernance(address newGovernance) external onlyOwner {
        require(newGovernance != address(0), "Invalid governance");
        governance = newGovernance;
    }

    // Receive function to accept ETH
    receive() external payable {
        // ETH revenue collection
        RevenueStream storage stream = revenueStreams[address(0)];
        if (!stream.isActive) {
            stream.token = address(0);
            stream.isActive = true;
            supportedTokens.push(address(0));
        }
        
        stream.totalCollected += msg.value;
        emit RevenueCollected(address(0), msg.value, msg.sender);
    }
}
