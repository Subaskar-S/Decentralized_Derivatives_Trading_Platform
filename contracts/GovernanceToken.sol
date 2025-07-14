// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceToken
 * @dev ERC20 token with voting capabilities for DAO governance
 */
contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, Ownable {
    
    // Total supply: 1 billion tokens
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18;
    
    // Distribution percentages
    uint256 public constant COMMUNITY_ALLOCATION = 60; // 60%
    uint256 public constant TEAM_ALLOCATION = 20;      // 20%
    uint256 public constant TREASURY_ALLOCATION = 15;  // 15%
    uint256 public constant LIQUIDITY_ALLOCATION = 5;  // 5%

    // Vesting parameters
    uint256 public constant TEAM_VESTING_DURATION = 4 * 365 days; // 4 years
    uint256 public constant TEAM_CLIFF_DURATION = 365 days;       // 1 year cliff
    
    // State variables
    uint256 public deploymentTime;
    uint256 public totalMinted;
    
    mapping(address => uint256) public teamAllocation;
    mapping(address => uint256) public teamClaimed;
    
    address public treasury;
    address public liquidityPool;
    
    bool public tradingEnabled;

    constructor(
        address _treasury,
        address _liquidityPool
    ) 
        ERC20("DerivativesDAO", "DDAO") 
        ERC20Permit("DerivativesDAO")
        Ownable(msg.sender)
    {
        deploymentTime = block.timestamp;
        treasury = _treasury;
        liquidityPool = _liquidityPool;
        
        // Mint initial allocations
        _mintInitialAllocations();
    }

    /**
     * @dev Mints initial token allocations
     */
    function _mintInitialAllocations() internal {
        uint256 treasuryAmount = (MAX_SUPPLY * TREASURY_ALLOCATION) / 100;
        uint256 liquidityAmount = (MAX_SUPPLY * LIQUIDITY_ALLOCATION) / 100;
        
        // Mint to treasury
        _mint(treasury, treasuryAmount);
        totalMinted += treasuryAmount;
        
        // Mint to liquidity pool
        _mint(liquidityPool, liquidityAmount);
        totalMinted += liquidityAmount;
    }

    /**
     * @dev Sets team allocation for vesting
     */
    function setTeamAllocation(
        address[] calldata teamMembers,
        uint256[] calldata amounts
    ) external onlyOwner {
        require(teamMembers.length == amounts.length, "Arrays length mismatch");
        
        uint256 totalTeamAllocation = (MAX_SUPPLY * TEAM_ALLOCATION) / 100;
        uint256 allocatedSoFar = 0;
        
        for (uint256 i = 0; i < teamMembers.length; i++) {
            teamAllocation[teamMembers[i]] = amounts[i];
            allocatedSoFar += amounts[i];
        }
        
        require(allocatedSoFar <= totalTeamAllocation, "Exceeds team allocation");
    }

    /**
     * @dev Claims vested team tokens
     */
    function claimTeamTokens() external {
        uint256 allocation = teamAllocation[msg.sender];
        require(allocation > 0, "No team allocation");
        
        uint256 vested = getVestedAmount(msg.sender);
        uint256 claimed = teamClaimed[msg.sender];
        uint256 claimable = vested - claimed;
        
        require(claimable > 0, "No tokens to claim");
        
        teamClaimed[msg.sender] = vested;
        totalMinted += claimable;
        
        _mint(msg.sender, claimable);
    }

    /**
     * @dev Calculates vested amount for a team member
     */
    function getVestedAmount(address teamMember) public view returns (uint256) {
        uint256 allocation = teamAllocation[teamMember];
        if (allocation == 0) return 0;
        
        uint256 elapsed = block.timestamp - deploymentTime;
        
        // No vesting before cliff
        if (elapsed < TEAM_CLIFF_DURATION) {
            return 0;
        }
        
        // Full vesting after duration
        if (elapsed >= TEAM_VESTING_DURATION) {
            return allocation;
        }
        
        // Linear vesting between cliff and full duration
        return (allocation * elapsed) / TEAM_VESTING_DURATION;
    }

    /**
     * @dev Mints community rewards (only owner)
     */
    function mintCommunityRewards(address to, uint256 amount) external onlyOwner {
        uint256 maxCommunityMint = (MAX_SUPPLY * COMMUNITY_ALLOCATION) / 100;
        require(totalMinted + amount <= MAX_SUPPLY, "Exceeds max supply");
        require(
            balanceOf(address(this)) + amount <= maxCommunityMint,
            "Exceeds community allocation"
        );
        
        totalMinted += amount;
        _mint(to, amount);
    }

    /**
     * @dev Enables trading (only owner)
     */
    function enableTrading() external onlyOwner {
        tradingEnabled = true;
    }

    /**
     * @dev Updates treasury address (only owner)
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury address");
        treasury = _treasury;
    }

    /**
     * @dev Updates liquidity pool address (only owner)
     */
    function setLiquidityPool(address _liquidityPool) external onlyOwner {
        require(_liquidityPool != address(0), "Invalid liquidity pool address");
        liquidityPool = _liquidityPool;
    }

    /**
     * @dev Burns tokens from caller's balance
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @dev Burns tokens from specified account (with allowance)
     */
    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }

    // Override required functions
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        // Restrict transfers before trading is enabled (except minting and burning)
        if (!tradingEnabled && from != address(0) && to != address(0)) {
            require(
                from == owner() || to == owner() || 
                from == treasury || to == treasury ||
                from == liquidityPool || to == liquidityPool,
                "Trading not enabled"
            );
        }
        
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }

    // View functions
    function getCirculatingSupply() external view returns (uint256) {
        return totalMinted;
    }

    function getRemainingTeamAllocation() external view returns (uint256) {
        uint256 totalTeamAllocation = (MAX_SUPPLY * TEAM_ALLOCATION) / 100;
        return totalTeamAllocation - totalMinted;
    }

    function getClaimableTeamTokens(address teamMember) external view returns (uint256) {
        uint256 vested = getVestedAmount(teamMember);
        uint256 claimed = teamClaimed[teamMember];
        return vested > claimed ? vested - claimed : 0;
    }
}
