'use client'

import { useState, useEffect } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Percent,
  Clock,
  AlertTriangle,
  Eye,
  X
} from 'lucide-react'
import { clsx } from 'clsx'
import { DERIVATIVES_ENGINE_ABI, getContractAddress, formatCurrency } from '@/lib/web3'

interface Position {
  id: string
  symbol: string
  side: 'long' | 'short'
  size: number
  collateral: number
  entryPrice: number
  currentPrice: number
  pnl: number
  pnlPercentage: number
  liquidationPrice: number
  fundingFee: number
  marginRatio: number
  entryTime: number
}

// Mock positions data - in real app, this would come from contracts/subgraph
const MOCK_POSITIONS: Position[] = [
  {
    id: '0x1234...5678',
    symbol: 'ETH/USD',
    side: 'long',
    size: 10000,
    collateral: 1000,
    entryPrice: 2400,
    currentPrice: 2450,
    pnl: 208.33,
    pnlPercentage: 20.83,
    liquidationPrice: 2160,
    fundingFee: -2.5,
    marginRatio: 0.12,
    entryTime: Date.now() - 3600000 // 1 hour ago
  },
  {
    id: '0x2345...6789',
    symbol: 'BTC/USD',
    side: 'short',
    size: 5000,
    collateral: 500,
    entryPrice: 43500,
    currentPrice: 43250,
    pnl: 28.74,
    pnlPercentage: 5.75,
    liquidationPrice: 48300,
    fundingFee: 1.2,
    marginRatio: 0.11,
    entryTime: Date.now() - 7200000 // 2 hours ago
  }
]

export function PortfolioOverview() {
  const [positions, setPositions] = useState<Position[]>(MOCK_POSITIONS)
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null)
  const { address, isConnected } = useAccount()

  // Calculate portfolio totals
  const totalPnL = positions.reduce((sum, pos) => sum + pos.pnl, 0)
  const totalCollateral = positions.reduce((sum, pos) => sum + pos.collateral, 0)
  const totalSize = positions.reduce((sum, pos) => sum + pos.size, 0)
  const totalFundingFees = positions.reduce((sum, pos) => sum + pos.fundingFee, 0)

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    const hours = Math.floor(diff / 3600000)
    const minutes = Math.floor((diff % 3600000) / 60000)
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ago`
    }
    return `${minutes}m ago`
  }

  const getRiskLevel = (marginRatio: number) => {
    if (marginRatio > 0.15) return { level: 'Low', color: 'text-green-600 bg-green-50' }
    if (marginRatio > 0.08) return { level: 'Medium', color: 'text-yellow-600 bg-yellow-50' }
    return { level: 'High', color: 'text-red-600 bg-red-50' }
  }

  if (!isConnected) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <DollarSign className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Connect Your Wallet</h3>
        <p className="text-gray-500">Connect your wallet to view your trading positions</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total PnL</p>
              <p className={clsx(
                'text-2xl font-bold',
                totalPnL >= 0 ? 'text-green-600' : 'text-red-600'
              )}>
                {totalPnL >= 0 ? '+' : ''}{formatCurrency(totalPnL)}
              </p>
            </div>
            {totalPnL >= 0 ? (
              <TrendingUp className="w-8 h-8 text-green-600" />
            ) : (
              <TrendingDown className="w-8 h-8 text-red-600" />
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Collateral</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalCollateral)}</p>
            </div>
            <DollarSign className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Size</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSize)}</p>
            </div>
            <Percent className="w-8 h-8 text-purple-600" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Funding Fees</p>
              <p className={clsx(
                'text-2xl font-bold',
                totalFundingFees >= 0 ? 'text-green-600' : 'text-red-600'
              )}>
                {totalFundingFees >= 0 ? '+' : ''}{formatCurrency(totalFundingFees)}
              </p>
            </div>
            <Clock className="w-8 h-8 text-orange-600" />
          </div>
        </div>
      </div>

      {/* Positions Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Open Positions</h2>
        </div>

        {positions.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <TrendingUp className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Open Positions</h3>
            <p className="text-gray-500">Start trading to see your positions here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Market
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Side
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Entry Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Current Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PnL
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Risk
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {positions.map((position) => {
                  const risk = getRiskLevel(position.marginRatio)
                  return (
                    <tr key={position.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{position.symbol}</div>
                        <div className="text-sm text-gray-500">{formatTime(position.entryTime)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={clsx(
                          'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
                          position.side === 'long'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        )}>
                          {position.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {formatCurrency(position.size)}
                        </div>
                        <div className="text-sm text-gray-500">
                          Collateral: {formatCurrency(position.collateral)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatCurrency(position.entryPrice)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatCurrency(position.currentPrice)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className={clsx(
                          'text-sm font-medium',
                          position.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                        )}>
                          {position.pnl >= 0 ? '+' : ''}{formatCurrency(position.pnl)}
                        </div>
                        <div className={clsx(
                          'text-xs',
                          position.pnlPercentage >= 0 ? 'text-green-600' : 'text-red-600'
                        )}>
                          {position.pnlPercentage >= 0 ? '+' : ''}{position.pnlPercentage.toFixed(2)}%
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={clsx(
                          'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
                          risk.color
                        )}>
                          {risk.level}
                        </span>
                        <div className="text-xs text-gray-500 mt-1">
                          Liq: {formatCurrency(position.liquidationPrice)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => setSelectedPosition(position)}
                          className="text-blue-600 hover:text-blue-900 mr-3"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className="text-red-600 hover:text-red-900">
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Position Detail Modal */}
      {selectedPosition && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Position Details
              </h3>
              <button
                onClick={() => setSelectedPosition(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-600">Market:</span>
                <span className="font-medium">{selectedPosition.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Side:</span>
                <span className={clsx(
                  'font-medium',
                  selectedPosition.side === 'long' ? 'text-green-600' : 'text-red-600'
                )}>
                  {selectedPosition.side.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Size:</span>
                <span className="font-medium">{formatCurrency(selectedPosition.size)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Collateral:</span>
                <span className="font-medium">{formatCurrency(selectedPosition.collateral)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Entry Price:</span>
                <span className="font-medium">{formatCurrency(selectedPosition.entryPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Current Price:</span>
                <span className="font-medium">{formatCurrency(selectedPosition.currentPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Liquidation Price:</span>
                <span className="font-medium text-red-600">
                  {formatCurrency(selectedPosition.liquidationPrice)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Funding Fee:</span>
                <span className={clsx(
                  'font-medium',
                  selectedPosition.fundingFee >= 0 ? 'text-green-600' : 'text-red-600'
                )}>
                  {selectedPosition.fundingFee >= 0 ? '+' : ''}{formatCurrency(selectedPosition.fundingFee)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Margin Ratio:</span>
                <span className="font-medium">
                  {(selectedPosition.marginRatio * 100).toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="mt-6 flex space-x-3">
              <button className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition-colors">
                Close Position
              </button>
              <button className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors">
                Add Collateral
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
