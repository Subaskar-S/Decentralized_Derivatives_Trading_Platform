// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title InsuranceFund
 * @dev Insurance fund to cover bad debt and maintain system stability
 */
contract InsuranceFund is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct FundMetrics {
        uint256 totalContributions;
        uint256 totalClaims;
        uint256 currentBalance;
        uint256 reserveRatio;
        uint256 targetRatio;
        bool isActive;
    }

    struct Contributor {
        uint256 totalContributed;
        uint256 lastContribution;
        uint256 rewardsClaimed;
        bool isActive;
    }

    struct Claim {
        bytes32 claimId;
        address claimant;
        uint256 amount;
        string reason;
        uint256 timestamp;
        bool isApproved;
        bool isPaid;
    }

    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MIN_CONTRIBUTION = 100 * 1e18; // $100 minimum
    uint256 public constant TARGET_RESERVE_RATIO = 2000; // 20%
    uint256 public constant MAX_CLAIM_RATIO = 1000; // 10% of fund per claim
    uint256 public constant REWARD_RATE = 500; // 5% annual reward for contributors

    // State variables
    IERC20 public collateralToken;
    address public riskManager;
    address public derivativesEngine;
    
    FundMetrics public fundMetrics;
    mapping(address => Contributor) public contributors;
    mapping(bytes32 => Claim) public claims;
    mapping(address => bool) public authorizedClaimants;
    
    address[] public contributorList;
    bytes32[] public pendingClaims;
    bytes32[] public approvedClaims;
    
    uint256 public lastRewardDistribution;
    uint256 public totalRewardsDistributed;

    // Events
    event ContributionMade(address indexed contributor, uint256 amount, uint256 newBalance);
    event ClaimSubmitted(bytes32 indexed claimId, address indexed claimant, uint256 amount, string reason);
    event ClaimApproved(bytes32 indexed claimId, address indexed approver);
    event ClaimPaid(bytes32 indexed claimId, uint256 amount);
    event ClaimRejected(bytes32 indexed claimId, string reason);
    event RewardsDistributed(uint256 totalAmount, uint256 contributorCount);
    event EmergencyWithdrawal(address indexed recipient, uint256 amount, string reason);
    event FundStatusChanged(bool isActive, string reason);

    constructor(
        address _collateralToken,
        address _riskManager,
        address _derivativesEngine
    ) Ownable(msg.sender) {
        collateralToken = IERC20(_collateralToken);
        riskManager = _riskManager;
        derivativesEngine = _derivativesEngine;
        
        fundMetrics = FundMetrics({
            totalContributions: 0,
            totalClaims: 0,
            currentBalance: 0,
            reserveRatio: 0,
            targetRatio: TARGET_RESERVE_RATIO,
            isActive: true
        });
        
        lastRewardDistribution = block.timestamp;
        
        // Authorize risk manager and derivatives engine to submit claims
        authorizedClaimants[_riskManager] = true;
        authorizedClaimants[_derivativesEngine] = true;
    }

    /**
     * @dev Contributes funds to the insurance fund
     */
    function contribute(uint256 amount) external nonReentrant {
        require(fundMetrics.isActive, "Fund not active");
        require(amount >= MIN_CONTRIBUTION, "Amount below minimum");
        
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update contributor info
        Contributor storage contributor = contributors[msg.sender];
        if (!contributor.isActive) {
            contributor.isActive = true;
            contributorList.push(msg.sender);
        }
        
        contributor.totalContributed += amount;
        contributor.lastContribution = block.timestamp;
        
        // Update fund metrics
        fundMetrics.totalContributions += amount;
        fundMetrics.currentBalance += amount;
        _updateReserveRatio();
        
        emit ContributionMade(msg.sender, amount, fundMetrics.currentBalance);
    }

    /**
     * @dev Submits a claim for bad debt coverage
     */
    function submitClaim(
        uint256 amount,
        string calldata reason,
        bytes calldata evidence
    ) external returns (bytes32 claimId) {
        require(authorizedClaimants[msg.sender], "Not authorized to submit claims");
        require(amount > 0, "Invalid amount");
        require(amount <= (fundMetrics.currentBalance * MAX_CLAIM_RATIO) / BASIS_POINTS, "Claim too large");
        
        claimId = keccak256(abi.encodePacked(msg.sender, amount, reason, block.timestamp));
        
        claims[claimId] = Claim({
            claimId: claimId,
            claimant: msg.sender,
            amount: amount,
            reason: reason,
            timestamp: block.timestamp,
            isApproved: false,
            isPaid: false
        });
        
        pendingClaims.push(claimId);
        
        emit ClaimSubmitted(claimId, msg.sender, amount, reason);
        return claimId;
    }

    /**
     * @dev Approves a pending claim
     */
    function approveClaim(bytes32 claimId) external onlyOwner {
        Claim storage claim = claims[claimId];
        require(claim.claimId != bytes32(0), "Claim not found");
        require(!claim.isApproved, "Already approved");
        require(!claim.isPaid, "Already paid");
        require(claim.amount <= fundMetrics.currentBalance, "Insufficient funds");
        
        claim.isApproved = true;
        
        // Move from pending to approved
        _removeFromPendingClaims(claimId);
        approvedClaims.push(claimId);
        
        emit ClaimApproved(claimId, msg.sender);
    }

    /**
     * @dev Pays an approved claim
     */
    function payClaim(bytes32 claimId) external nonReentrant {
        Claim storage claim = claims[claimId];
        require(claim.isApproved, "Claim not approved");
        require(!claim.isPaid, "Already paid");
        require(claim.amount <= fundMetrics.currentBalance, "Insufficient funds");
        
        claim.isPaid = true;
        
        // Update fund metrics
        fundMetrics.totalClaims += claim.amount;
        fundMetrics.currentBalance -= claim.amount;
        _updateReserveRatio();
        
        // Transfer funds
        collateralToken.safeTransfer(claim.claimant, claim.amount);
        
        emit ClaimPaid(claimId, claim.amount);
    }

    /**
     * @dev Rejects a pending claim
     */
    function rejectClaim(bytes32 claimId, string calldata reason) external onlyOwner {
        Claim storage claim = claims[claimId];
        require(claim.claimId != bytes32(0), "Claim not found");
        require(!claim.isApproved, "Already approved");
        require(!claim.isPaid, "Already paid");
        
        // Remove from pending claims
        _removeFromPendingClaims(claimId);
        
        emit ClaimRejected(claimId, reason);
    }

    /**
     * @dev Distributes rewards to contributors
     */
    function distributeRewards() external onlyOwner {
        require(block.timestamp >= lastRewardDistribution + 365 days, "Too early for rewards");
        require(fundMetrics.currentBalance > 0, "No funds to distribute");
        
        uint256 rewardPool = (fundMetrics.currentBalance * REWARD_RATE) / BASIS_POINTS;
        require(rewardPool <= fundMetrics.currentBalance, "Insufficient funds for rewards");
        
        uint256 totalContributions = fundMetrics.totalContributions;
        uint256 distributedRewards = 0;
        
        for (uint256 i = 0; i < contributorList.length; i++) {
            address contributorAddr = contributorList[i];
            Contributor storage contributor = contributors[contributorAddr];
            
            if (!contributor.isActive || contributor.totalContributed == 0) continue;
            
            // Calculate proportional reward
            uint256 reward = (rewardPool * contributor.totalContributed) / totalContributions;
            
            if (reward > 0) {
                contributor.rewardsClaimed += reward;
                distributedRewards += reward;
                
                collateralToken.safeTransfer(contributorAddr, reward);
            }
        }
        
        // Update fund metrics
        fundMetrics.currentBalance -= distributedRewards;
        totalRewardsDistributed += distributedRewards;
        lastRewardDistribution = block.timestamp;
        
        _updateReserveRatio();
        
        emit RewardsDistributed(distributedRewards, contributorList.length);
    }

    /**
     * @dev Emergency withdrawal function
     */
    function emergencyWithdraw(
        address recipient,
        uint256 amount,
        string calldata reason
    ) external onlyOwner {
        require(amount <= fundMetrics.currentBalance, "Insufficient funds");
        require(recipient != address(0), "Invalid recipient");
        
        fundMetrics.currentBalance -= amount;
        _updateReserveRatio();
        
        collateralToken.safeTransfer(recipient, amount);
        
        emit EmergencyWithdrawal(recipient, amount, reason);
    }

    /**
     * @dev Sets fund active status
     */
    function setFundStatus(bool isActive, string calldata reason) external onlyOwner {
        fundMetrics.isActive = isActive;
        emit FundStatusChanged(isActive, reason);
    }

    /**
     * @dev Adds authorized claimant
     */
    function addAuthorizedClaimant(address claimant) external onlyOwner {
        require(claimant != address(0), "Invalid address");
        authorizedClaimants[claimant] = true;
    }

    /**
     * @dev Removes authorized claimant
     */
    function removeAuthorizedClaimant(address claimant) external onlyOwner {
        authorizedClaimants[claimant] = false;
    }

    /**
     * @dev Gets fund health metrics
     */
    function getFundHealth() external view returns (
        uint256 currentBalance,
        uint256 reserveRatio,
        uint256 targetRatio,
        bool isHealthy,
        bool needsContributions
    ) {
        currentBalance = fundMetrics.currentBalance;
        reserveRatio = fundMetrics.reserveRatio;
        targetRatio = fundMetrics.targetRatio;
        isHealthy = reserveRatio >= targetRatio;
        needsContributions = reserveRatio < (targetRatio / 2); // Critical if below 10%
    }

    /**
     * @dev Gets contributor information
     */
    function getContributorInfo(address contributor) external view returns (
        uint256 totalContributed,
        uint256 lastContribution,
        uint256 rewardsClaimed,
        uint256 pendingRewards,
        bool isActive
    ) {
        Contributor memory contrib = contributors[contributor];
        
        // Calculate pending rewards
        uint256 rewardPool = (fundMetrics.currentBalance * REWARD_RATE) / BASIS_POINTS;
        uint256 pendingReward = 0;
        
        if (fundMetrics.totalContributions > 0 && contrib.totalContributed > 0) {
            pendingReward = (rewardPool * contrib.totalContributed) / fundMetrics.totalContributions;
        }
        
        return (
            contrib.totalContributed,
            contrib.lastContribution,
            contrib.rewardsClaimed,
            pendingReward,
            contrib.isActive
        );
    }

    /**
     * @dev Gets pending claims
     */
    function getPendingClaims() external view returns (bytes32[] memory) {
        return pendingClaims;
    }

    /**
     * @dev Gets approved claims
     */
    function getApprovedClaims() external view returns (bytes32[] memory) {
        return approvedClaims;
    }

    /**
     * @dev Gets claim details
     */
    function getClaimDetails(bytes32 claimId) external view returns (
        address claimant,
        uint256 amount,
        string memory reason,
        uint256 timestamp,
        bool isApproved,
        bool isPaid
    ) {
        Claim memory claim = claims[claimId];
        return (
            claim.claimant,
            claim.amount,
            claim.reason,
            claim.timestamp,
            claim.isApproved,
            claim.isPaid
        );
    }

    // Internal functions
    function _updateReserveRatio() internal {
        // Simplified calculation - in practice would use total system exposure
        uint256 totalSystemValue = 10000000 * 1e18; // $10M placeholder
        
        if (totalSystemValue > 0) {
            fundMetrics.reserveRatio = (fundMetrics.currentBalance * BASIS_POINTS) / totalSystemValue;
        }
    }

    function _removeFromPendingClaims(bytes32 claimId) internal {
        for (uint256 i = 0; i < pendingClaims.length; i++) {
            if (pendingClaims[i] == claimId) {
                pendingClaims[i] = pendingClaims[pendingClaims.length - 1];
                pendingClaims.pop();
                break;
            }
        }
    }

    // View functions
    function getContributorCount() external view returns (uint256) {
        return contributorList.length;
    }

    function getPendingClaimsCount() external view returns (uint256) {
        return pendingClaims.length;
    }

    function getApprovedClaimsCount() external view returns (uint256) {
        return approvedClaims.length;
    }
}
