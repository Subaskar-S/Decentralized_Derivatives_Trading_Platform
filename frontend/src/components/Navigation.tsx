'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useBalance } from 'wagmi'
import { 
  TrendingUp, 
  BarChart3, 
  Vote, 
  Settings, 
  Menu, 
  X,
  Wallet,
  Shield,
  Users
} from 'lucide-react'
import { clsx } from 'clsx'

const navigation = [
  { name: 'Trading', href: '/', icon: TrendingUp },
  { name: 'Portfolio', href: '/portfolio', icon: BarChart3 },
  { name: 'Governance', href: '/governance', icon: Vote },
  { name: 'Risk', href: '/risk', icon: Shield },
  { name: 'Community', href: '/community', icon: Users },
]

export function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const { data: balance } = useBalance({ address })

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and main navigation */}
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-gray-900">DerivativesDAO</span>
              </Link>
            </div>
            
            {/* Desktop navigation */}
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navigation.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={clsx(
                      'inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-blue-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    )}
                  >
                    <item.icon className="w-4 h-4 mr-2" />
                    {item.name}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right side - wallet connection and user info */}
          <div className="hidden sm:ml-6 sm:flex sm:items-center sm:space-x-4">
            {isConnected && balance && (
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <Wallet className="w-4 h-4" />
                <span>{parseFloat(balance.formatted).toFixed(4)} {balance.symbol}</span>
              </div>
            )}
            
            <ConnectButton 
              chainStatus="icon"
              accountStatus={{
                smallScreen: 'avatar',
                largeScreen: 'full',
              }}
            />
          </div>

          {/* Mobile menu button */}
          <div className="sm:hidden flex items-center">
            <button
              type="button"
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="block h-6 w-6" />
              ) : (
                <Menu className="block h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="sm:hidden">
          <div className="pt-2 pb-3 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={clsx(
                    'block pl-3 pr-4 py-2 border-l-4 text-base font-medium transition-colors',
                    isActive
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <div className="flex items-center">
                    <item.icon className="w-5 h-5 mr-3" />
                    {item.name}
                  </div>
                </Link>
              )
            })}
          </div>
          
          {/* Mobile wallet section */}
          <div className="pt-4 pb-3 border-t border-gray-200">
            <div className="px-4 space-y-3">
              {isConnected && balance && (
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                  <Wallet className="w-4 h-4" />
                  <span>{parseFloat(balance.formatted).toFixed(4)} {balance.symbol}</span>
                </div>
              )}
              <ConnectButton 
                chainStatus="icon"
                accountStatus="full"
              />
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}

export function NavigationSkeleton() {
  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-gray-200 rounded-lg animate-pulse" />
            <div className="ml-2 w-32 h-6 bg-gray-200 rounded animate-pulse" />
          </div>
          <div className="flex items-center space-x-4">
            <div className="w-24 h-8 bg-gray-200 rounded animate-pulse" />
            <div className="w-32 h-10 bg-gray-200 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    </nav>
  )
}
