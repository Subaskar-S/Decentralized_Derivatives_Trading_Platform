import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatPercentage(value: number, decimals: number = 2): string {
  return `${(value * 100).toFixed(decimals)}%`
}

export function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return `${seconds}s ago`
}

export function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export function calculatePnL(
  entryPrice: number,
  currentPrice: number,
  size: number,
  isLong: boolean
): { pnl: number; pnlPercentage: number } {
  const priceDiff = isLong ? currentPrice - entryPrice : entryPrice - currentPrice
  const pnl = (priceDiff / entryPrice) * size
  const pnlPercentage = (priceDiff / entryPrice) * 100
  
  return { pnl, pnlPercentage }
}

export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  isLong: boolean,
  maintenanceMargin: number = 0.06
): number {
  const marginRatio = 1 / leverage
  const liquidationRatio = marginRatio - maintenanceMargin
  
  if (isLong) {
    return entryPrice * (1 - liquidationRatio)
  } else {
    return entryPrice * (1 + liquidationRatio)
  }
}

export function validateTradeInputs(
  size: string,
  leverage: number,
  limitPrice?: string
): { isValid: boolean; error?: string } {
  const sizeNum = parseFloat(size)
  const limitPriceNum = limitPrice ? parseFloat(limitPrice) : null
  
  if (!size || isNaN(sizeNum) || sizeNum <= 0) {
    return { isValid: false, error: 'Invalid position size' }
  }
  
  if (leverage < 1 || leverage > 50) {
    return { isValid: false, error: 'Leverage must be between 1x and 50x' }
  }
  
  if (limitPrice && (isNaN(limitPriceNum!) || limitPriceNum! <= 0)) {
    return { isValid: false, error: 'Invalid limit price' }
  }
  
  if (sizeNum < 10) {
    return { isValid: false, error: 'Minimum position size is $10' }
  }
  
  if (sizeNum > 1000000) {
    return { isValid: false, error: 'Maximum position size is $1M' }
  }
  
  return { isValid: true }
}

export function calculateRequiredCollateral(size: number, leverage: number): number {
  return size / leverage
}

export function calculateTradingFee(size: number, feeRate: number = 0.001): number {
  return size * feeRate
}

export function calculateFundingFee(
  size: number,
  fundingRate: number,
  timeHeld: number // in hours
): number {
  return size * fundingRate * (timeHeld / 8) // Funding paid every 8 hours
}

export function getRiskLevel(marginRatio: number): {
  level: 'Low' | 'Medium' | 'High' | 'Critical'
  color: string
} {
  if (marginRatio > 0.15) {
    return { level: 'Low', color: 'text-green-600 bg-green-50' }
  } else if (marginRatio > 0.10) {
    return { level: 'Medium', color: 'text-yellow-600 bg-yellow-50' }
  } else if (marginRatio > 0.06) {
    return { level: 'High', color: 'text-orange-600 bg-orange-50' }
  } else {
    return { level: 'Critical', color: 'text-red-600 bg-red-50' }
  }
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

export function generatePositionId(): string {
  return `0x${Math.random().toString(16).substr(2, 8)}...${Math.random().toString(16).substr(2, 4)}`
}

export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
