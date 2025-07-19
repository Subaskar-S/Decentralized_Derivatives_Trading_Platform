'use client'

import { useState, useEffect } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Percent,
  Clock,
  AlertTriangle,
  Info
} from 'lucide-react'
import { clsx } from 'clsx'
import { DERIVATIVES_ENGINE_ABI, PRICE_ORACLE_ABI, getContractAddress, formatPrice, formatCurrency } from '@/lib/web3'

interface MarketData {
  symbol: string
  price: number
  change24h: number
  volume24h: number
  fundingRate: number
  openInterest: number
}

const MARKETS: MarketData[] = [
  {
    symbol: 'ETH/USD',
    price: 2450.50,
    change24h: 2.34,
    volume24h: 125000000,
    fundingRate: 0.0001,
    openInterest: 45000000
  },
  {
    symbol: 'BTC/USD',
    price: 43250.75,
    change24h: -1.23,
    volume24h: 89000000,
    fundingRate: -0.0002,
    openInterest: 78000000
  },
  {
    symbol: 'SOL/USD',
    price: 98.45,
    change24h: 5.67,
    volume24h: 34000000,
    fundingRate: 0.0003,
    openInterest: 12000000
  }
]

export function TradingInterface() {
  const [selectedMarket, setSelectedMarket] = useState<MarketData>(MARKETS[0])
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(10)
  const [limitPrice, setLimitPrice] = useState('')
  const [slippage, setSlippage] = useState(0.5)

  const { address, isConnected, chain } = useAccount()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  // Get current price from oracle
  const { data: priceData } = useReadContract({
    address: getContractAddress(chain?.id || 1, 'priceOracle') as `0x${string}`,
    abi: PRICE_ORACLE_ABI,
    functionName: 'getPrice',
    args: [selectedMarket.symbol],
    query: {
      refetchInterval: 1000, // Refresh every second
    }
  })

  const currentPrice = priceData ? parseFloat(formatPrice(priceData.price)) : selectedMarket.price

  const handleTrade = async () => {
    if (!isConnected || !address || !size) return

    const sizeInWei = parseUnits(size, 18)
    const collateral = sizeInWei / BigInt(leverage)
    const maxSlippageInBps = Math.floor(slippage * 100) // Convert to basis points

    try {
      await writeContract({
        address: getContractAddress(chain?.id || 1, 'derivativesEngine') as `0x${string}`,
        abi: DERIVATIVES_ENGINE_ABI,
        functionName: 'openPosition',
        args: [
          selectedMarket.symbol,
          sizeInWei,
          collateral,
          side === 'long',
          BigInt(maxSlippageInBps)
        ]
      })
    } catch (error) {
      console.error('Trade failed:', error)
    }
  }

  const calculateLiquidationPrice = () => {
    const maintenanceMargin = 0.06 // 6%
    const entryPrice = orderType === 'limit' && limitPrice ? parseFloat(limitPrice) : currentPrice
    
    if (side === 'long') {
      return entryPrice * (1 - (1/leverage - maintenanceMargin))
    } else {
      return entryPrice * (1 + (1/leverage - maintenanceMargin))
    }
  }

  const calculateFees = () => {
    if (!size) return 0
    const tradingFee = 0.001 // 0.1%
    return parseFloat(size) * tradingFee
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Market Selection */}
      <div className="lg:col-span-2">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Markets</h2>
          
          <div className="space-y-2">
            {MARKETS.map((market) => (
              <button
                key={market.symbol}
                onClick={() => setSelectedMarket(market)}
                className={clsx(
                  'w-full p-4 rounded-lg border text-left transition-colors',
                  selectedMarket.symbol === market.symbol
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">{market.symbol}</div>
                    <div className="text-sm text-gray-500">
                      Vol: {formatCurrency(market.volume24h / 1000000)}M
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className="font-medium text-gray-900">
                      {formatCurrency(market.price)}
                    </div>
                    <div className={clsx(
                      'text-sm flex items-center',
                      market.change24h >= 0 ? 'text-green-600' : 'text-red-600'
                    )}>
                      {market.change24h >= 0 ? (
                        <TrendingUp className="w-3 h-3 mr-1" />
                      ) : (
                        <TrendingDown className="w-3 h-3 mr-1" />
                      )}
                      {Math.abs(market.change24h).toFixed(2)}%
                    </div>
                  </div>
                </div>
                
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>Funding: {(market.fundingRate * 100).toFixed(4)}%</span>
                  <span>OI: {formatCurrency(market.openInterest / 1000000)}M</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Trading Panel */}
      <div className="space-y-6">
        {/* Order Form */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Trade {selectedMarket.symbol}
          </h3>

          {/* Order Type */}
          <div className="mb-4">
            <div className="flex rounded-lg border border-gray-300 p-1">
              <button
                onClick={() => setOrderType('market')}
                className={clsx(
                  'flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                  orderType === 'market'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:text-gray-900'
                )}
              >
                Market
              </button>
              <button
                onClick={() => setOrderType('limit')}
                className={clsx(
                  'flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                  orderType === 'limit'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:text-gray-900'
                )}
              >
                Limit
              </button>
            </div>
          </div>

          {/* Side Selection */}
          <div className="mb-4">
            <div className="flex rounded-lg border border-gray-300 p-1">
              <button
                onClick={() => setSide('long')}
                className={clsx(
                  'flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                  side === 'long'
                    ? 'bg-green-600 text-white'
                    : 'text-gray-700 hover:text-gray-900'
                )}
              >
                Long
              </button>
              <button
                onClick={() => setSide('short')}
                className={clsx(
                  'flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                  side === 'short'
                    ? 'bg-red-600 text-white'
                    : 'text-gray-700 hover:text-gray-900'
                )}
              >
                Short
              </button>
            </div>
          </div>

          {/* Limit Price (if limit order) */}
          {orderType === 'limit' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Limit Price
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <DollarSign className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            </div>
          )}

          {/* Size */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Size (USD)
            </label>
            <div className="relative">
              <input
                type="number"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                <DollarSign className="w-4 h-4 text-gray-400" />
              </div>
            </div>
          </div>

          {/* Leverage */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Leverage: {leverage}x
            </label>
            <input
              type="range"
              min="1"
              max="50"
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1x</span>
              <span>25x</span>
              <span>50x</span>
            </div>
          </div>

          {/* Slippage */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Max Slippage: {slippage}%
            </label>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={slippage}
              onChange={(e) => setSlippage(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Trade Summary */}
          {size && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Collateral Required:</span>
                <span className="font-medium">{formatCurrency(parseFloat(size) / leverage)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Liquidation Price:</span>
                <span className="font-medium">{formatCurrency(calculateLiquidationPrice())}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Trading Fee:</span>
                <span className="font-medium">{formatCurrency(calculateFees())}</span>
              </div>
            </div>
          )}

          {/* Trade Button */}
          <button
            onClick={handleTrade}
            disabled={!isConnected || !size || isPending || isConfirming}
            className={clsx(
              'w-full py-3 px-4 rounded-lg font-medium transition-colors',
              !isConnected || !size || isPending || isConfirming
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : side === 'long'
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            )}
          >
            {!isConnected ? 'Connect Wallet' :
             isPending ? 'Confirming...' :
             isConfirming ? 'Processing...' :
             `${side === 'long' ? 'Long' : 'Short'} ${selectedMarket.symbol}`}
          </button>

          {isSuccess && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center">
                <Info className="w-4 h-4 text-green-600 mr-2" />
                <span className="text-sm text-green-800">Trade executed successfully!</span>
              </div>
            </div>
          )}
        </div>

        {/* Market Info */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Market Info</h3>
          
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Current Price:</span>
              <span className="font-medium">{formatCurrency(currentPrice)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">24h Change:</span>
              <span className={clsx(
                'font-medium',
                selectedMarket.change24h >= 0 ? 'text-green-600' : 'text-red-600'
              )}>
                {selectedMarket.change24h >= 0 ? '+' : ''}{selectedMarket.change24h.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">24h Volume:</span>
              <span className="font-medium">{formatCurrency(selectedMarket.volume24h / 1000000)}M</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Funding Rate:</span>
              <span className={clsx(
                'font-medium',
                selectedMarket.fundingRate >= 0 ? 'text-green-600' : 'text-red-600'
              )}>
                {(selectedMarket.fundingRate * 100).toFixed(4)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Open Interest:</span>
              <span className="font-medium">{formatCurrency(selectedMarket.openInterest / 1000000)}M</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
