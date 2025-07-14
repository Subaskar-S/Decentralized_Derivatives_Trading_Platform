import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import {
  ProposalCreated,
  ProposalCreatedWithCategory,
  VoteCast,
  ProposalExecuted,
  ProposalCanceled,
  VoteDelegated,
} from "../generated/AdvancedGovernance/AdvancedGovernance";
import {
  Proposal,
  Vote,
  TokenHolder,
  GovernanceToken,
  DailyStats,
  ProtocolMetrics,
} from "../generated/schema";
import {
  getOrCreateTokenHolder,
  getOrCreateGovernanceToken,
  getOrCreateDailyStats,
  getOrCreateProtocolMetrics,
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
} from "./helpers";

export function handleProposalCreated(event: ProposalCreated): void {
  let proposal = new Proposal(event.params.proposalId.toString());
  
  proposal.proposalId = event.params.proposalId;
  proposal.proposer = event.params.proposer;
  proposal.title = event.params.title;
  proposal.description = event.params.description;
  proposal.ipfsHash = event.params.ipfsHash;
  proposal.category = "PROTOCOL"; // Default category for legacy events
  proposal.startTime = event.params.startTime;
  proposal.endTime = event.params.endTime;
  proposal.forVotes = ZERO_BI;
  proposal.againstVotes = ZERO_BI;
  proposal.abstainVotes = ZERO_BI;
  proposal.totalVotes = ZERO_BI;
  proposal.quorumRequired = ZERO_BI; // Will be calculated based on category
  proposal.state = "PENDING";
  proposal.executed = false;
  proposal.cancelled = false;
  proposal.createdAt = event.block.timestamp;
  proposal.updatedAt = event.block.timestamp;
  proposal.blockNumber = event.block.number;
  proposal.transactionHash = event.transaction.hash;
  
  proposal.save();
  
  // Update daily stats
  let dailyStats = getOrCreateDailyStats(event.block.timestamp);
  dailyStats.proposalsCreated = dailyStats.proposalsCreated.plus(ONE_BI);
  dailyStats.save();
  
  // Update protocol metrics
  let protocolMetrics = getOrCreateProtocolMetrics();
  protocolMetrics.totalProposals = protocolMetrics.totalProposals.plus(ONE_BI);
  protocolMetrics.lastUpdated = event.block.timestamp;
  protocolMetrics.save();
}

export function handleProposalCreatedWithCategory(event: ProposalCreatedWithCategory): void {
  let proposal = new Proposal(event.params.proposalId.toString());
  
  proposal.proposalId = event.params.proposalId;
  proposal.proposer = event.params.proposer;
  proposal.title = event.params.title;
  proposal.description = event.params.description;
  proposal.ipfsHash = event.params.ipfsHash;
  
  // Map category enum to string
  let categoryValue = event.params.category;
  if (categoryValue == 0) {
    proposal.category = "PARAMETER";
  } else if (categoryValue == 1) {
    proposal.category = "TREASURY";
  } else if (categoryValue == 2) {
    proposal.category = "PROTOCOL";
  } else if (categoryValue == 3) {
    proposal.category = "EMERGENCY";
  } else if (categoryValue == 4) {
    proposal.category = "COMMUNITY";
  } else {
    proposal.category = "PROTOCOL"; // Default fallback
  }
  
  proposal.startTime = ZERO_BI; // Will be set by contract
  proposal.endTime = ZERO_BI; // Will be set by contract
  proposal.forVotes = ZERO_BI;
  proposal.againstVotes = ZERO_BI;
  proposal.abstainVotes = ZERO_BI;
  proposal.totalVotes = ZERO_BI;
  proposal.quorumRequired = calculateQuorumRequired(proposal.category);
  proposal.state = "PENDING";
  proposal.executed = false;
  proposal.cancelled = false;
  proposal.createdAt = event.block.timestamp;
  proposal.updatedAt = event.block.timestamp;
  proposal.blockNumber = event.block.number;
  proposal.transactionHash = event.transaction.hash;
  
  proposal.save();
  
  // Update daily stats
  let dailyStats = getOrCreateDailyStats(event.block.timestamp);
  dailyStats.proposalsCreated = dailyStats.proposalsCreated.plus(ONE_BI);
  dailyStats.save();
  
  // Update protocol metrics
  let protocolMetrics = getOrCreateProtocolMetrics();
  protocolMetrics.totalProposals = protocolMetrics.totalProposals.plus(ONE_BI);
  protocolMetrics.lastUpdated = event.block.timestamp;
  protocolMetrics.save();
}

export function handleVoteCast(event: VoteCast): void {
  let proposalId = event.params.proposalId.toString();
  let voterId = event.params.voter.toHexString();
  let voteId = proposalId + "-" + voterId;
  
  let vote = new Vote(voteId);
  vote.proposal = proposalId;
  vote.voter = event.params.voter;
  vote.weight = event.params.weight;
  vote.reason = event.params.reason;
  vote.timestamp = event.block.timestamp;
  vote.blockNumber = event.block.number;
  vote.transactionHash = event.transaction.hash;
  
  // Map support value to enum
  let supportValue = event.params.support;
  if (supportValue == 0) {
    vote.support = "AGAINST";
  } else if (supportValue == 1) {
    vote.support = "FOR";
  } else if (supportValue == 2) {
    vote.support = "ABSTAIN";
  } else {
    vote.support = "ABSTAIN"; // Default fallback
  }
  
  vote.save();
  
  // Update proposal vote counts
  let proposal = Proposal.load(proposalId);
  if (proposal) {
    if (vote.support == "FOR") {
      proposal.forVotes = proposal.forVotes.plus(event.params.weight);
    } else if (vote.support == "AGAINST") {
      proposal.againstVotes = proposal.againstVotes.plus(event.params.weight);
    } else if (vote.support == "ABSTAIN") {
      proposal.abstainVotes = proposal.abstainVotes.plus(event.params.weight);
    }
    
    proposal.totalVotes = proposal.forVotes.plus(proposal.againstVotes).plus(proposal.abstainVotes);
    proposal.updatedAt = event.block.timestamp;
    
    // Update proposal state based on voting results
    updateProposalState(proposal, event.block.timestamp);
    
    proposal.save();
  }
  
  // Update token holder voting activity
  let tokenHolder = getOrCreateTokenHolder(event.params.voter);
  tokenHolder.lastTransferAt = event.block.timestamp; // Use as last activity
  tokenHolder.save();
  
  // Update daily stats
  let dailyStats = getOrCreateDailyStats(event.block.timestamp);
  dailyStats.votescast = dailyStats.votescast.plus(ONE_BI);
  dailyStats.save();
  
  // Update protocol metrics
  let protocolMetrics = getOrCreateProtocolMetrics();
  protocolMetrics.totalVotes = protocolMetrics.totalVotes.plus(ONE_BI);
  
  // Calculate governance participation rate
  let governanceToken = getOrCreateGovernanceToken();
  if (governanceToken.totalSupply.gt(ZERO_BI)) {
    let participatingVotes = proposal ? proposal.totalVotes : ZERO_BI;
    protocolMetrics.governanceParticipation = participatingVotes.toBigDecimal()
      .div(governanceToken.totalSupply.toBigDecimal())
      .times(BigDecimal.fromString("100"));
  }
  
  protocolMetrics.lastUpdated = event.block.timestamp;
  protocolMetrics.save();
}

export function handleProposalExecuted(event: ProposalExecuted): void {
  let proposalId = event.params.proposalId.toString();
  let proposal = Proposal.load(proposalId);
  
  if (proposal) {
    proposal.executed = true;
    proposal.state = "EXECUTED";
    proposal.updatedAt = event.block.timestamp;
    proposal.save();
  }
}

export function handleProposalCanceled(event: ProposalCanceled): void {
  let proposalId = event.params.proposalId.toString();
  let proposal = Proposal.load(proposalId);
  
  if (proposal) {
    proposal.cancelled = true;
    proposal.state = "CANCELLED";
    proposal.updatedAt = event.block.timestamp;
    proposal.save();
  }
}

export function handleVoteDelegated(event: VoteDelegated): void {
  let delegator = getOrCreateTokenHolder(event.params.delegator);
  let delegate = getOrCreateTokenHolder(event.params.delegate);
  
  // Update delegator
  delegator.delegate = event.params.delegate;
  delegator.votingPower = ZERO_BI; // Delegated away
  delegator.lastTransferAt = event.block.timestamp;
  delegator.save();
  
  // Update delegate
  delegate.votingPower = delegate.votingPower.plus(event.params.votes);
  delegate.lastTransferAt = event.block.timestamp;
  delegate.save();
  
  // Update governance token stats
  let governanceToken = getOrCreateGovernanceToken();
  governanceToken.totalDelegates = governanceToken.totalDelegates.plus(ONE_BI);
  governanceToken.updatedAt = event.block.timestamp;
  governanceToken.save();
}

// Helper functions
function calculateQuorumRequired(category: string): BigInt {
  // Calculate quorum based on category
  // These percentages should match the contract configuration
  let governanceToken = getOrCreateGovernanceToken();
  let totalSupply = governanceToken.totalSupply;
  
  if (category == "PARAMETER") {
    return totalSupply.times(BigInt.fromI32(3)).div(BigInt.fromI32(100)); // 3%
  } else if (category == "TREASURY") {
    return totalSupply.times(BigInt.fromI32(4)).div(BigInt.fromI32(100)); // 4%
  } else if (category == "PROTOCOL") {
    return totalSupply.times(BigInt.fromI32(5)).div(BigInt.fromI32(100)); // 5%
  } else if (category == "EMERGENCY") {
    return totalSupply.times(BigInt.fromI32(8)).div(BigInt.fromI32(100)); // 8%
  } else if (category == "COMMUNITY") {
    return totalSupply.times(BigInt.fromI32(2)).div(BigInt.fromI32(100)); // 2%
  } else {
    return totalSupply.times(BigInt.fromI32(5)).div(BigInt.fromI32(100)); // Default 5%
  }
}

function updateProposalState(proposal: Proposal, currentTimestamp: BigInt): void {
  // Update proposal state based on current conditions
  if (proposal.cancelled) {
    proposal.state = "CANCELLED";
    return;
  }
  
  if (proposal.executed) {
    proposal.state = "EXECUTED";
    return;
  }
  
  if (currentTimestamp.lt(proposal.startTime)) {
    proposal.state = "PENDING";
  } else if (currentTimestamp.le(proposal.endTime)) {
    proposal.state = "ACTIVE";
  } else {
    // Voting period ended, determine outcome
    if (proposal.totalVotes.lt(proposal.quorumRequired)) {
      proposal.state = "DEFEATED";
    } else if (proposal.forVotes.gt(proposal.againstVotes)) {
      proposal.state = "SUCCEEDED";
    } else {
      proposal.state = "DEFEATED";
    }
  }
}

function isQuorumReached(proposal: Proposal): boolean {
  return proposal.totalVotes.ge(proposal.quorumRequired);
}

function isProposalPassing(proposal: Proposal): boolean {
  return proposal.forVotes.gt(proposal.againstVotes);
}
