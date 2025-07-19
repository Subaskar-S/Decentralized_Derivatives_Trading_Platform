import { createConfig, http } from 'wagmi'
import { optimism, optimismSepolia, hardhat } from 'wagmi/chains'
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors'

// WalletConnect project ID - replace with your own
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id'

export const config = createConfig({
  chains: [optimism, optimismSepolia, hardhat],
  connectors: [
    injected(),
    walletConnect({ projectId }),
    coinbaseWallet({ appName: 'Derivatives DAO' }),
  ],
  transports: {
    [optimism.id]: http(),
    [optimismSepolia.id]: http(),
    [hardhat.id]: http('http://127.0.0.1:8545'),
  },
})

// Contract addresses - these would be populated after deployment
export const CONTRACT_ADDRESSES = {
  [optimism.id]: {
    derivativesEngine: '0x...',
    priceOracle: '0x...',
    riskManager: '0x...',
    governance: '0x...',
    governanceToken: '0x...',
    treasury: '0x...',
    usdc: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', // USDC on Optimism
  },
  [optimismSepolia.id]: {
    derivativesEngine: '0x...',
    priceOracle: '0x...',
    riskManager: '0x...',
    governance: '0x...',
    governanceToken: '0x...',
    treasury: '0x...',
    usdc: '0x...',
  },
  [hardhat.id]: {
    derivativesEngine: '0x...',
    priceOracle: '0x...',
    riskManager: '0x...',
    governance: '0x...',
    governanceToken: '0x...',
    treasury: '0x...',
    usdc: '0x...',
  },
}

// Contract ABIs - simplified for demo
export const DERIVATIVES_ENGINE_ABI = [
  {
    "inputs": [
      {"name": "symbol", "type": "string"},
      {"name": "size", "type": "uint256"},
      {"name": "collateral", "type": "uint256"},
      {"name": "isLong", "type": "bool"},
      {"name": "maxSlippage", "type": "uint256"}
    ],
    "name": "openPosition",
    "outputs": [{"name": "positionId", "type": "bytes32"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "positionId", "type": "bytes32"},
      {"name": "maxSlippage", "type": "uint256"}
    ],
    "name": "closePosition",
    "outputs": [{"name": "pnl", "type": "int256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "positionId", "type": "bytes32"}],
    "name": "getPosition",
    "outputs": [{
      "components": [
        {"name": "trader", "type": "address"},
        {"name": "size", "type": "uint256"},
        {"name": "collateral", "type": "uint256"},
        {"name": "entryPrice", "type": "uint256"},
        {"name": "entryTime", "type": "uint256"},
        {"name": "isLong", "type": "bool"},
        {"name": "fundingIndex", "type": "uint256"}
      ],
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "positionId", "type": "bytes32"}],
    "name": "calculatePnL",
    "outputs": [{"name": "", "type": "int256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const

export const PRICE_ORACLE_ABI = [
  {
    "inputs": [{"name": "symbol", "type": "string"}],
    "name": "getPrice",
    "outputs": [{
      "components": [
        {"name": "price", "type": "uint256"},
        {"name": "timestamp", "type": "uint256"},
        {"name": "confidence", "type": "uint256"},
        {"name": "isValid", "type": "bool"}
      ],
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "symbol", "type": "string"}, {"name": "period", "type": "uint256"}],
    "name": "getTWAP",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const

export const GOVERNANCE_ABI = [
  {
    "inputs": [
      {"name": "targets", "type": "address[]"},
      {"name": "values", "type": "uint256[]"},
      {"name": "calldatas", "type": "bytes[]"},
      {"name": "title", "type": "string"},
      {"name": "description", "type": "string"},
      {"name": "ipfsHash", "type": "string"}
    ],
    "name": "propose",
    "outputs": [{"name": "proposalId", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "proposalId", "type": "uint256"},
      {"name": "support", "type": "uint8"}
    ],
    "name": "castVote",
    "outputs": [{"name": "weight", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "proposalId", "type": "uint256"}],
    "name": "getProposal",
    "outputs": [{
      "components": [
        {"name": "id", "type": "uint256"},
        {"name": "proposer", "type": "address"},
        {"name": "title", "type": "string"},
        {"name": "description", "type": "string"},
        {"name": "ipfsHash", "type": "string"},
        {"name": "startTime", "type": "uint256"},
        {"name": "endTime", "type": "uint256"},
        {"name": "forVotes", "type": "uint256"},
        {"name": "againstVotes", "type": "uint256"},
        {"name": "abstainVotes", "type": "uint256"},
        {"name": "state", "type": "uint8"}
      ],
      "name": "",
      "type": "tuple"
    }],
    "stateMutability": "view",
    "type": "function"
  }
] as const

export const ERC20_ABI = [
  {
    "inputs": [{"name": "account", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "spender", "type": "address"},
      {"name": "amount", "type": "uint256"}
    ],
    "name": "approve",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "owner", "type": "address"},
      {"name": "spender", "type": "address"}
    ],
    "name": "allowance",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const

// Utility functions
export function getContractAddress(chainId: number, contract: keyof typeof CONTRACT_ADDRESSES[number]) {
  return CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES]?.[contract]
}

export function formatPrice(price: bigint, decimals: number = 18): string {
  const divisor = BigInt(10 ** decimals)
  const wholePart = price / divisor
  const fractionalPart = price % divisor
  
  if (fractionalPart === 0n) {
    return wholePart.toString()
  }
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0')
  const trimmedFractional = fractionalStr.replace(/0+$/, '')
  
  return `${wholePart}.${trimmedFractional}`
}

export function parsePrice(price: string, decimals: number = 18): bigint {
  const [whole, fractional = ''] = price.split('.')
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + paddedFractional)
}

export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
