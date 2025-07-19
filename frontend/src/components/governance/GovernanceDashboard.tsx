'use client'

import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract } from 'wagmi'
import { 
  Vote, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Users, 
  TrendingUp,
  FileText,
  ExternalLink
} from 'lucide-react'
import { clsx } from 'clsx'
import { GOVERNANCE_ABI, getContractAddress, formatCurrency } from '@/lib/web3'

interface Proposal {
  id: number
  title: string
  description: string
  proposer: string
  category: 'Parameter' | 'Treasury' | 'Protocol' | 'Emergency' | 'Community'
  state: 'Pending' | 'Active' | 'Succeeded' | 'Defeated' | 'Executed' | 'Cancelled'
  startTime: number
  endTime: number
  forVotes: number
  againstVotes: number
  abstainVotes: number
  quorumRequired: number
  ipfsHash?: string
}

// Mock proposals data
const MOCK_PROPOSALS: Proposal[] = [
  {
    id: 1,
    title: 'Update ETH/USD Risk Parameters',
    description: 'Proposal to adjust the maintenance margin ratio for ETH/USD from 6% to 8% to improve system stability.',
    proposer: '0x1234...5678',
    category: 'Parameter',
    state: 'Active',
    startTime: Date.now() - 86400000, // 1 day ago
    endTime: Date.now() + 432000000, // 5 days from now
    forVotes: 1250000,
    againstVotes: 340000,
    abstainVotes: 120000,
    quorumRequired: 3000000,
    ipfsHash: 'QmExample1'
  },
  {
    id: 2,
    title: 'Treasury Allocation for Development',
    description: 'Allocate 500,000 USDC from treasury for Q1 2024 development initiatives including new market integrations.',
    proposer: '0x2345...6789',
    category: 'Treasury',
    state: 'Succeeded',
    startTime: Date.now() - 1209600000, // 14 days ago
    endTime: Date.now() - 604800000, // 7 days ago
    forVotes: 4200000,
    againstVotes: 800000,
    abstainVotes: 200000,
    quorumRequired: 4000000,
    ipfsHash: 'QmExample2'
  },
  {
    id: 3,
    title: 'Add SOL/USD Perpetual Market',
    description: 'Proposal to add Solana perpetual futures market with 25x maximum leverage and Pyth oracle integration.',
    proposer: '0x3456...7890',
    category: 'Protocol',
    state: 'Pending',
    startTime: Date.now() + 172800000, // 2 days from now
    endTime: Date.now() + 1036800000, // 12 days from now
    forVotes: 0,
    againstVotes: 0,
    abstainVotes: 0,
    quorumRequired: 5000000,
    ipfsHash: 'QmExample3'
  }
]

export function GovernanceDashboard() {
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null)
  const [voteChoice, setVoteChoice] = useState<0 | 1 | 2>(1) // 0: Against, 1: For, 2: Abstain
  const { address, isConnected } = useAccount()
  const { writeContract, isPending } = useWriteContract()

  const getStateColor = (state: Proposal['state']) => {
    switch (state) {
      case 'Active': return 'bg-blue-100 text-blue-800'
      case 'Succeeded': return 'bg-green-100 text-green-800'
      case 'Defeated': return 'bg-red-100 text-red-800'
      case 'Executed': return 'bg-purple-100 text-purple-800'
      case 'Pending': return 'bg-yellow-100 text-yellow-800'
      case 'Cancelled': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getCategoryColor = (category: Proposal['category']) => {
    switch (category) {
      case 'Parameter': return 'bg-blue-50 text-blue-700 border-blue-200'
      case 'Treasury': return 'bg-green-50 text-green-700 border-green-200'
      case 'Protocol': return 'bg-purple-50 text-purple-700 border-purple-200'
      case 'Emergency': return 'bg-red-50 text-red-700 border-red-200'
      case 'Community': return 'bg-orange-50 text-orange-700 border-orange-200'
      default: return 'bg-gray-50 text-gray-700 border-gray-200'
    }
  }

  const formatTimeRemaining = (endTime: number) => {
    const now = Date.now()
    const diff = endTime - now
    
    if (diff <= 0) return 'Ended'
    
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    
    if (days > 0) return `${days}d ${hours}h remaining`
    return `${hours}h remaining`
  }

  const calculateQuorumProgress = (proposal: Proposal) => {
    const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes
    return Math.min((totalVotes / proposal.quorumRequired) * 100, 100)
  }

  const handleVote = async (proposalId: number, support: 0 | 1 | 2) => {
    if (!isConnected) return

    try {
      await writeContract({
        address: getContractAddress(1, 'governance') as `0x${string}`, // Use appropriate chain
        abi: GOVERNANCE_ABI,
        functionName: 'castVote',
        args: [BigInt(proposalId), support]
      })
    } catch (error) {
      console.error('Vote failed:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Governance Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Proposals</p>
              <p className="text-2xl font-bold text-gray-900">
                {MOCK_PROPOSALS.filter(p => p.state === 'Active').length}
              </p>
            </div>
            <Vote className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Proposals</p>
              <p className="text-2xl font-bold text-gray-900">{MOCK_PROPOSALS.length}</p>
            </div>
            <FileText className="w-8 h-8 text-green-600" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Voting Power</p>
              <p className="text-2xl font-bold text-gray-900">125.4K</p>
            </div>
            <TrendingUp className="w-8 h-8 text-purple-600" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Participation</p>
              <p className="text-2xl font-bold text-gray-900">67.8%</p>
            </div>
            <Users className="w-8 h-8 text-orange-600" />
          </div>
        </div>
      </div>

      {/* Proposals List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Governance Proposals</h2>
        </div>

        <div className="divide-y divide-gray-200">
          {MOCK_PROPOSALS.map((proposal) => {
            const quorumProgress = calculateQuorumProgress(proposal)
            const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes
            const forPercentage = totalVotes > 0 ? (proposal.forVotes / totalVotes) * 100 : 0
            const againstPercentage = totalVotes > 0 ? (proposal.againstVotes / totalVotes) * 100 : 0

            return (
              <div key={proposal.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-medium text-gray-900">
                        #{proposal.id} {proposal.title}
                      </h3>
                      <span className={clsx(
                        'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
                        getStateColor(proposal.state)
                      )}>
                        {proposal.state}
                      </span>
                      <span className={clsx(
                        'inline-flex px-2 py-1 text-xs font-medium rounded border',
                        getCategoryColor(proposal.category)
                      )}>
                        {proposal.category}
                      </span>
                    </div>

                    <p className="text-gray-600 mb-4 line-clamp-2">{proposal.description}</p>

                    <div className="flex items-center space-x-6 text-sm text-gray-500 mb-4">
                      <span>Proposer: {proposal.proposer}</span>
                      <span className="flex items-center">
                        <Clock className="w-4 h-4 mr-1" />
                        {formatTimeRemaining(proposal.endTime)}
                      </span>
                      {proposal.ipfsHash && (
                        <a 
                          href={`https://ipfs.io/ipfs/${proposal.ipfsHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center text-blue-600 hover:text-blue-800"
                        >
                          <ExternalLink className="w-4 h-4 mr-1" />
                          Details
                        </a>
                      )}
                    </div>

                    {/* Voting Results */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">Quorum Progress</span>
                        <span className="font-medium">{quorumProgress.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${quorumProgress}%` }}
                        />
                      </div>

                      {totalVotes > 0 && (
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-green-600 font-medium">For</span>
                              <span>{forPercentage.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1">
                              <div 
                                className="bg-green-600 h-1 rounded-full"
                                style={{ width: `${forPercentage}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {(proposal.forVotes / 1000000).toFixed(1)}M votes
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-red-600 font-medium">Against</span>
                              <span>{againstPercentage.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1">
                              <div 
                                className="bg-red-600 h-1 rounded-full"
                                style={{ width: `${againstPercentage}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {(proposal.againstVotes / 1000000).toFixed(1)}M votes
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-gray-600 font-medium">Abstain</span>
                              <span>{((proposal.abstainVotes / totalVotes) * 100).toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1">
                              <div 
                                className="bg-gray-600 h-1 rounded-full"
                                style={{ width: `${(proposal.abstainVotes / totalVotes) * 100}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {(proposal.abstainVotes / 1000000).toFixed(1)}M votes
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Voting Actions */}
                  {proposal.state === 'Active' && isConnected && (
                    <div className="ml-6 flex flex-col space-y-2">
                      <button
                        onClick={() => handleVote(proposal.id, 1)}
                        disabled={isPending}
                        className="flex items-center px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        For
                      </button>
                      <button
                        onClick={() => handleVote(proposal.id, 0)}
                        disabled={isPending}
                        className="flex items-center px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Against
                      </button>
                      <button
                        onClick={() => handleVote(proposal.id, 2)}
                        disabled={isPending}
                        className="flex items-center px-3 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
                      >
                        Abstain
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create Proposal Button */}
      {isConnected && (
        <div className="text-center">
          <button className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors">
            Create New Proposal
          </button>
        </div>
      )}
    </div>
  )
}
