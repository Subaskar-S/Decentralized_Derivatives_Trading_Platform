// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IGovernance.sol";

/**
 * @title Governance
 * @dev DAO governance system with token-weighted voting
 */
contract Governance is IGovernance, Ownable {
    
    // Constants
    uint256 public constant VOTING_DELAY = 1 days;
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant PROPOSAL_THRESHOLD = 100000 * 1e18; // 100k tokens
    uint256 public constant QUORUM_PERCENTAGE = 4; // 4% of total supply

    // State variables
    IERC20 public governanceToken;
    uint256 public proposalCount;
    
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => uint256)) public votes;

    constructor(address _governanceToken) Ownable(msg.sender) {
        governanceToken = IERC20(_governanceToken);
    }

    /**
     * @dev Creates a new proposal
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory title,
        string memory description,
        string memory ipfsHash
    ) external returns (uint256 proposalId) {
        require(
            governanceToken.balanceOf(msg.sender) >= PROPOSAL_THRESHOLD,
            "Insufficient tokens to propose"
        );
        require(targets.length == values.length, "Targets and values length mismatch");
        require(targets.length == calldatas.length, "Targets and calldatas length mismatch");
        require(targets.length > 0, "Empty proposal");

        proposalId = ++proposalCount;
        
        uint256 startTime = block.timestamp + VOTING_DELAY;
        uint256 endTime = startTime + VOTING_PERIOD;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            title: title,
            description: description,
            ipfsHash: ipfsHash,
            startTime: startTime,
            endTime: endTime,
            forVotes: 0,
            againstVotes: 0,
            abstainVotes: 0,
            state: ProposalState.Pending,
            calldatas: calldatas,
            targets: targets,
            values: values
        });

        emit ProposalCreated(
            proposalId,
            msg.sender,
            title,
            ipfsHash,
            startTime,
            endTime
        );

        return proposalId;
    }

    /**
     * @dev Casts a vote on a proposal
     */
    function castVote(
        uint256 proposalId,
        uint8 support
    ) external returns (uint256 weight) {
        return _castVote(proposalId, msg.sender, support, "");
    }

    /**
     * @dev Casts a vote with a reason
     */
    function castVoteWithReason(
        uint256 proposalId,
        uint8 support,
        string calldata reason
    ) external returns (uint256 weight) {
        return _castVote(proposalId, msg.sender, support, reason);
    }

    /**
     * @dev Executes a successful proposal
     */
    function execute(uint256 proposalId) external {
        require(state(proposalId) == ProposalState.Succeeded, "Proposal not succeeded");
        
        Proposal storage proposal = proposals[proposalId];
        proposal.state = ProposalState.Executed;

        for (uint256 i = 0; i < proposal.targets.length; i++) {
            (bool success, ) = proposal.targets[i].call{value: proposal.values[i]}(
                proposal.calldatas[i]
            );
            require(success, "Execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    /**
     * @dev Cancels a proposal (only proposer or owner)
     */
    function cancel(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        require(
            msg.sender == proposal.proposer || msg.sender == owner(),
            "Only proposer or owner can cancel"
        );
        require(
            state(proposalId) == ProposalState.Pending || state(proposalId) == ProposalState.Active,
            "Cannot cancel executed proposal"
        );

        proposal.state = ProposalState.Canceled;
        emit ProposalCanceled(proposalId);
    }

    /**
     * @dev Gets proposal details
     */
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    /**
     * @dev Gets the current state of a proposal
     */
    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage proposal = proposals[proposalId];
        
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
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
        uint256 requiredQuorum = quorum(proposal.startTime);

        if (totalVotes < requiredQuorum) {
            return ProposalState.Defeated;
        }

        if (proposal.forVotes > proposal.againstVotes) {
            return ProposalState.Succeeded;
        } else {
            return ProposalState.Defeated;
        }
    }

    /**
     * @dev Gets voting power of an account at a specific block
     */
    function getVotes(address account, uint256 blockNumber) external view returns (uint256) {
        // Simplified implementation - in practice, this would use checkpoints
        // to get historical balances
        return governanceToken.balanceOf(account);
    }

    /**
     * @dev Checks if an account has voted on a proposal
     */
    function hasVotedOnProposal(uint256 proposalId, address account) external view returns (bool) {
        return hasVoted[proposalId][account];
    }

    /**
     * @dev Gets the voting delay
     */
    function votingDelay() external pure returns (uint256) {
        return VOTING_DELAY;
    }

    /**
     * @dev Gets the voting period
     */
    function votingPeriod() external pure returns (uint256) {
        return VOTING_PERIOD;
    }

    /**
     * @dev Gets the proposal threshold
     */
    function proposalThreshold() external pure returns (uint256) {
        return PROPOSAL_THRESHOLD;
    }

    /**
     * @dev Calculates quorum for a given block number
     */
    function quorum(uint256 blockNumber) public view returns (uint256) {
        uint256 totalSupply = governanceToken.totalSupply();
        return (totalSupply * QUORUM_PERCENTAGE) / 100;
    }

    // Internal functions
    function _castVote(
        uint256 proposalId,
        address voter,
        uint8 support,
        string memory reason
    ) internal returns (uint256 weight) {
        require(state(proposalId) == ProposalState.Active, "Voting not active");
        require(!hasVoted[proposalId][voter], "Already voted");
        require(support <= 2, "Invalid support value");

        weight = governanceToken.balanceOf(voter);
        require(weight > 0, "No voting power");

        hasVoted[proposalId][voter] = true;
        votes[proposalId][voter] = weight;

        Proposal storage proposal = proposals[proposalId];
        
        if (support == 0) {
            proposal.againstVotes += weight;
        } else if (support == 1) {
            proposal.forVotes += weight;
        } else {
            proposal.abstainVotes += weight;
        }

        emit VoteCast(voter, proposalId, support, weight, reason);

        return weight;
    }

    // Admin functions
    function setGovernanceToken(address _governanceToken) external onlyOwner {
        governanceToken = IERC20(_governanceToken);
    }

    /**
     * @dev Emergency function to update proposal state (only owner)
     */
    function emergencyUpdateProposalState(
        uint256 proposalId,
        ProposalState newState
    ) external onlyOwner {
        proposals[proposalId].state = newState;
    }

    // Receive function to accept ETH
    receive() external payable {}
}
