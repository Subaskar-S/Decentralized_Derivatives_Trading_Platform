// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IGovernance
 * @dev Interface for DAO governance system
 */
interface IGovernance {
    enum ProposalState {
        Pending,
        Active,
        Canceled,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }

    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        string ipfsHash;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        ProposalState state;
        bytes[] calldatas;
        address[] targets;
        uint256[] values;
    }

    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string title,
        string ipfsHash,
        uint256 startTime,
        uint256 endTime
    );

    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        uint8 support,
        uint256 weight,
        string reason
    );

    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);

    // Core functions
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory title,
        string memory description,
        string memory ipfsHash
    ) external returns (uint256 proposalId);

    function castVote(
        uint256 proposalId,
        uint8 support
    ) external returns (uint256 weight);

    function castVoteWithReason(
        uint256 proposalId,
        uint8 support,
        string calldata reason
    ) external returns (uint256 weight);

    function execute(uint256 proposalId) external;
    function cancel(uint256 proposalId) external;

    // View functions
    function getProposal(uint256 proposalId) external view returns (Proposal memory);
    function state(uint256 proposalId) external view returns (ProposalState);
    function getVotes(address account, uint256 blockNumber) external view returns (uint256);
    function hasVotedOnProposal(uint256 proposalId, address account) external view returns (bool);
    
    // Configuration
    function votingDelay() external view returns (uint256);
    function votingPeriod() external view returns (uint256);
    function proposalThreshold() external view returns (uint256);
    function quorum(uint256 blockNumber) external view returns (uint256);
}
