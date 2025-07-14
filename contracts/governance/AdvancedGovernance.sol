// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "../interfaces/IGovernance.sol";

/**
 * @title AdvancedGovernance
 * @dev Enhanced DAO governance with delegation, categories, and timelock
 */
contract AdvancedGovernance is IGovernance, Ownable, ReentrancyGuard {
    
    enum ProposalCategory {
        Parameter,      // Risk parameters, fees, etc.
        Treasury,       // Treasury management
        Protocol,       // Protocol upgrades
        Emergency,      // Emergency actions
        Community       // Community initiatives
    }

    struct EnhancedProposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        string ipfsHash;
        ProposalCategory category;
        uint256 startTime;
        uint256 endTime;
        uint256 executionTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        ProposalState state;
        bytes[] calldatas;
        address[] targets;
        uint256[] values;
        mapping(address => Receipt) receipts;
    }

    struct Receipt {
        bool hasVoted;
        uint8 support;
        uint256 votes;
        string reason;
    }

    struct CategoryConfig {
        uint256 votingDelay;
        uint256 votingPeriod;
        uint256 proposalThreshold;
        uint256 quorumPercentage;
        uint256 timelockDelay;
        bool requiresTimelock;
    }

    struct DelegationInfo {
        address delegate;
        uint256 delegatedVotes;
        uint256 timestamp;
    }

    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MAX_OPERATIONS = 10;

    // State variables
    ERC20Votes public governanceToken;
    uint256 public proposalCount;
    
    mapping(uint256 => EnhancedProposal) public proposals;
    mapping(ProposalCategory => CategoryConfig) public categoryConfigs;
    mapping(address => DelegationInfo) public delegations;
    mapping(address => uint256) public proposerLastProposal;
    mapping(bytes32 => bool) public queuedTransactions;
    
    uint256 public proposalCooldown = 1 days;
    bool public emergencyMode = false;
    address public guardian;

    // Events
    event ProposalCreatedWithCategory(
        uint256 indexed proposalId,
        address indexed proposer,
        ProposalCategory category,
        string title,
        string ipfsHash
    );

    event VoteCastWithReceipt(
        address indexed voter,
        uint256 indexed proposalId,
        uint8 support,
        uint256 weight,
        string reason
    );

    event ProposalQueued(uint256 indexed proposalId, uint256 executionTime);
    event VoteDelegated(address indexed delegator, address indexed delegate, uint256 votes);
    event EmergencyModeToggled(bool enabled);
    event GuardianUpdated(address indexed newGuardian);

    constructor(
        address _governanceToken,
        address _guardian
    ) Ownable(msg.sender) {
        governanceToken = ERC20Votes(_governanceToken);
        guardian = _guardian;
        
        _initializeCategoryConfigs();
    }

    /**
     * @dev Creates a proposal with category-specific parameters
     */
    function proposeWithCategory(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory title,
        string memory description,
        string memory ipfsHash,
        ProposalCategory category
    ) external returns (uint256 proposalId) {
        require(!emergencyMode || category == ProposalCategory.Emergency, "Emergency mode active");
        require(targets.length == values.length, "Targets and values length mismatch");
        require(targets.length == calldatas.length, "Targets and calldatas length mismatch");
        require(targets.length > 0 && targets.length <= MAX_OPERATIONS, "Invalid operations count");
        
        CategoryConfig memory config = categoryConfigs[category];
        require(
            governanceToken.getPastVotes(msg.sender, block.number - 1) >= config.proposalThreshold,
            "Insufficient voting power"
        );
        
        // Enforce proposal cooldown
        require(
            block.timestamp >= proposerLastProposal[msg.sender] + proposalCooldown,
            "Proposal cooldown active"
        );
        
        proposalId = ++proposalCount;
        proposerLastProposal[msg.sender] = block.timestamp;
        
        uint256 startTime = block.timestamp + config.votingDelay;
        uint256 endTime = startTime + config.votingPeriod;
        
        EnhancedProposal storage proposal = proposals[proposalId];
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.title = title;
        proposal.description = description;
        proposal.ipfsHash = ipfsHash;
        proposal.category = category;
        proposal.startTime = startTime;
        proposal.endTime = endTime;
        proposal.state = ProposalState.Pending;
        proposal.calldatas = calldatas;
        proposal.targets = targets;
        proposal.values = values;
        
        emit ProposalCreatedWithCategory(proposalId, msg.sender, category, title, ipfsHash);
        emit ProposalCreated(proposalId, msg.sender, title, ipfsHash, startTime, endTime);
        
        return proposalId;
    }

    /**
     * @dev Standard propose function for interface compatibility
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory title,
        string memory description,
        string memory ipfsHash
    ) external returns (uint256 proposalId) {
        return proposeWithCategory(
            targets,
            values,
            calldatas,
            title,
            description,
            ipfsHash,
            ProposalCategory.Protocol
        );
    }

    /**
     * @dev Casts vote with delegation support
     */
    function castVote(uint256 proposalId, uint8 support) external returns (uint256 weight) {
        return _castVote(proposalId, msg.sender, support, "");
    }

    /**
     * @dev Casts vote with reason
     */
    function castVoteWithReason(
        uint256 proposalId,
        uint8 support,
        string calldata reason
    ) external returns (uint256 weight) {
        return _castVote(proposalId, msg.sender, support, reason);
    }

    /**
     * @dev Casts vote by signature
     */
    function castVoteBySig(
        uint256 proposalId,
        uint8 support,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 weight) {
        bytes32 domainSeparator = governanceToken.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Ballot(uint256 proposalId,uint8 support)"),
            proposalId,
            support
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "Invalid signature");
        
        return _castVote(proposalId, signer, support, "");
    }

    /**
     * @dev Queues a successful proposal for execution
     */
    function queue(uint256 proposalId) external {
        require(state(proposalId) == ProposalState.Succeeded, "Proposal not succeeded");
        
        EnhancedProposal storage proposal = proposals[proposalId];
        CategoryConfig memory config = categoryConfigs[proposal.category];
        
        if (config.requiresTimelock) {
            proposal.executionTime = block.timestamp + config.timelockDelay;
            proposal.state = ProposalState.Queued;
            
            // Mark transactions as queued
            for (uint256 i = 0; i < proposal.targets.length; i++) {
                bytes32 txHash = keccak256(abi.encode(
                    proposal.targets[i],
                    proposal.values[i],
                    proposal.calldatas[i],
                    proposal.executionTime
                ));
                queuedTransactions[txHash] = true;
            }
            
            emit ProposalQueued(proposalId, proposal.executionTime);
        } else {
            // Execute immediately for non-timelock categories
            _executeProposal(proposalId);
        }
    }

    /**
     * @dev Executes a queued proposal
     */
    function execute(uint256 proposalId) external nonReentrant {
        EnhancedProposal storage proposal = proposals[proposalId];
        require(
            state(proposalId) == ProposalState.Queued || 
            state(proposalId) == ProposalState.Succeeded,
            "Proposal not ready for execution"
        );
        
        CategoryConfig memory config = categoryConfigs[proposal.category];
        if (config.requiresTimelock) {
            require(block.timestamp >= proposal.executionTime, "Timelock not expired");
        }
        
        _executeProposal(proposalId);
    }

    /**
     * @dev Cancels a proposal
     */
    function cancel(uint256 proposalId) external {
        EnhancedProposal storage proposal = proposals[proposalId];
        require(
            msg.sender == proposal.proposer || 
            msg.sender == owner() || 
            msg.sender == guardian,
            "Not authorized to cancel"
        );
        require(
            state(proposalId) == ProposalState.Pending || 
            state(proposalId) == ProposalState.Active ||
            state(proposalId) == ProposalState.Queued,
            "Cannot cancel executed proposal"
        );
        
        proposal.state = ProposalState.Canceled;
        emit ProposalCanceled(proposalId);
    }

    /**
     * @dev Delegates voting power to another address
     */
    function delegate(address delegatee) external {
        require(delegatee != msg.sender, "Cannot delegate to self");
        
        uint256 currentVotes = governanceToken.getVotes(msg.sender);
        require(currentVotes > 0, "No votes to delegate");
        
        // Update delegation info
        delegations[msg.sender] = DelegationInfo({
            delegate: delegatee,
            delegatedVotes: currentVotes,
            timestamp: block.timestamp
        });
        
        // Delegate in the token contract
        governanceToken.delegate(delegatee);
        
        emit VoteDelegated(msg.sender, delegatee, currentVotes);
    }

    /**
     * @dev Removes delegation
     */
    function undelegate() external {
        DelegationInfo storage delegation = delegations[msg.sender];
        require(delegation.delegate != address(0), "No active delegation");
        
        address previousDelegate = delegation.delegate;
        uint256 previousVotes = delegation.delegatedVotes;
        
        // Clear delegation
        delete delegations[msg.sender];
        
        // Self-delegate in token contract
        governanceToken.delegate(msg.sender);
        
        emit VoteDelegated(msg.sender, msg.sender, previousVotes);
    }

    // View functions
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        EnhancedProposal storage enhanced = proposals[proposalId];
        
        return Proposal({
            id: enhanced.id,
            proposer: enhanced.proposer,
            title: enhanced.title,
            description: enhanced.description,
            ipfsHash: enhanced.ipfsHash,
            startTime: enhanced.startTime,
            endTime: enhanced.endTime,
            forVotes: enhanced.forVotes,
            againstVotes: enhanced.againstVotes,
            abstainVotes: enhanced.abstainVotes,
            state: enhanced.state,
            calldatas: enhanced.calldatas,
            targets: enhanced.targets,
            values: enhanced.values
        });
    }

    function getEnhancedProposal(uint256 proposalId) external view returns (
        uint256 id,
        address proposer,
        string memory title,
        ProposalCategory category,
        uint256 startTime,
        uint256 endTime,
        uint256 executionTime,
        ProposalState currentState
    ) {
        EnhancedProposal storage proposal = proposals[proposalId];
        return (
            proposal.id,
            proposal.proposer,
            proposal.title,
            proposal.category,
            proposal.startTime,
            proposal.endTime,
            proposal.executionTime,
            proposal.state
        );
    }

    function state(uint256 proposalId) public view returns (ProposalState) {
        EnhancedProposal storage proposal = proposals[proposalId];
        
        if (proposal.state == ProposalState.Canceled || 
            proposal.state == ProposalState.Executed) {
            return proposal.state;
        }
        
        if (block.timestamp < proposal.startTime) {
            return ProposalState.Pending;
        }
        
        if (block.timestamp <= proposal.endTime) {
            return ProposalState.Active;
        }
        
        // Voting period ended, determine outcome
        CategoryConfig memory config = categoryConfigs[proposal.category];
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
        uint256 requiredQuorum = (governanceToken.getPastTotalSupply(proposal.endTime) * config.quorumPercentage) / BASIS_POINTS;
        
        if (totalVotes < requiredQuorum) {
            return ProposalState.Defeated;
        }
        
        if (proposal.forVotes > proposal.againstVotes) {
            if (proposal.state == ProposalState.Queued) {
                if (block.timestamp >= proposal.executionTime + 14 days) {
                    return ProposalState.Expired;
                }
                return ProposalState.Queued;
            }
            return ProposalState.Succeeded;
        } else {
            return ProposalState.Defeated;
        }
    }

    function getVotes(address account, uint256 blockNumber) external view returns (uint256) {
        return governanceToken.getPastVotes(account, blockNumber);
    }

    function hasVotedOnProposal(uint256 proposalId, address account) external view returns (bool) {
        return proposals[proposalId].receipts[account].hasVoted;
    }

    function votingDelay() external view returns (uint256) {
        return categoryConfigs[ProposalCategory.Protocol].votingDelay;
    }

    function votingPeriod() external view returns (uint256) {
        return categoryConfigs[ProposalCategory.Protocol].votingPeriod;
    }

    function proposalThreshold() external view returns (uint256) {
        return categoryConfigs[ProposalCategory.Protocol].proposalThreshold;
    }

    function quorum(uint256 blockNumber) external view returns (uint256) {
        uint256 totalSupply = governanceToken.getPastTotalSupply(blockNumber);
        return (totalSupply * categoryConfigs[ProposalCategory.Protocol].quorumPercentage) / BASIS_POINTS;
    }

    // Internal functions
    function _castVote(
        uint256 proposalId,
        address voter,
        uint8 support,
        string memory reason
    ) internal returns (uint256 weight) {
        require(state(proposalId) == ProposalState.Active, "Voting not active");
        require(support <= 2, "Invalid support value");
        
        EnhancedProposal storage proposal = proposals[proposalId];
        Receipt storage receipt = proposal.receipts[voter];
        require(!receipt.hasVoted, "Already voted");
        
        weight = governanceToken.getPastVotes(voter, proposal.startTime - 1);
        require(weight > 0, "No voting power");
        
        receipt.hasVoted = true;
        receipt.support = support;
        receipt.votes = weight;
        receipt.reason = reason;
        
        if (support == 0) {
            proposal.againstVotes += weight;
        } else if (support == 1) {
            proposal.forVotes += weight;
        } else {
            proposal.abstainVotes += weight;
        }
        
        emit VoteCastWithReceipt(voter, proposalId, support, weight, reason);
        emit VoteCast(voter, proposalId, support, weight, reason);
        
        return weight;
    }

    function _executeProposal(uint256 proposalId) internal {
        EnhancedProposal storage proposal = proposals[proposalId];
        proposal.state = ProposalState.Executed;
        
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            (bool success, ) = proposal.targets[i].call{value: proposal.values[i]}(
                proposal.calldatas[i]
            );
            require(success, "Execution failed");
        }
        
        emit ProposalExecuted(proposalId);
    }

    function _initializeCategoryConfigs() internal {
        // Parameter changes: shorter timelock, lower threshold
        categoryConfigs[ProposalCategory.Parameter] = CategoryConfig({
            votingDelay: 1 days,
            votingPeriod: 5 days,
            proposalThreshold: 50000 * 1e18,  // 50k tokens
            quorumPercentage: 300,            // 3%
            timelockDelay: 2 days,
            requiresTimelock: true
        });
        
        // Treasury: moderate timelock
        categoryConfigs[ProposalCategory.Treasury] = CategoryConfig({
            votingDelay: 2 days,
            votingPeriod: 7 days,
            proposalThreshold: 100000 * 1e18, // 100k tokens
            quorumPercentage: 400,            // 4%
            timelockDelay: 3 days,
            requiresTimelock: true
        });
        
        // Protocol upgrades: longest timelock, highest threshold
        categoryConfigs[ProposalCategory.Protocol] = CategoryConfig({
            votingDelay: 3 days,
            votingPeriod: 10 days,
            proposalThreshold: 200000 * 1e18, // 200k tokens
            quorumPercentage: 500,            // 5%
            timelockDelay: 7 days,
            requiresTimelock: true
        });
        
        // Emergency: immediate execution, high threshold
        categoryConfigs[ProposalCategory.Emergency] = CategoryConfig({
            votingDelay: 0,
            votingPeriod: 2 days,
            proposalThreshold: 500000 * 1e18, // 500k tokens
            quorumPercentage: 800,            // 8%
            timelockDelay: 0,
            requiresTimelock: false
        });
        
        // Community: low threshold, moderate timelock
        categoryConfigs[ProposalCategory.Community] = CategoryConfig({
            votingDelay: 1 days,
            votingPeriod: 7 days,
            proposalThreshold: 25000 * 1e18,  // 25k tokens
            quorumPercentage: 200,            // 2%
            timelockDelay: 1 days,
            requiresTimelock: true
        });
    }

    // Admin functions
    function setEmergencyMode(bool enabled) external {
        require(msg.sender == guardian || msg.sender == owner(), "Not authorized");
        emergencyMode = enabled;
        emit EmergencyModeToggled(enabled);
    }

    function setGuardian(address newGuardian) external onlyOwner {
        require(newGuardian != address(0), "Invalid guardian");
        guardian = newGuardian;
        emit GuardianUpdated(newGuardian);
    }

    function setCategoryConfig(
        ProposalCategory category,
        CategoryConfig calldata config
    ) external onlyOwner {
        require(config.quorumPercentage <= 5000, "Quorum too high"); // Max 50%
        require(config.proposalThreshold > 0, "Invalid threshold");
        categoryConfigs[category] = config;
    }

    function setProposalCooldown(uint256 cooldown) external onlyOwner {
        require(cooldown <= 7 days, "Cooldown too long");
        proposalCooldown = cooldown;
    }

    // Receive function to accept ETH
    receive() external payable {}
}
