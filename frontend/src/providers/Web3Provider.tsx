'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit'
import { optimism, optimismSepolia, hardhat } from 'wagmi/chains'
import { config } from '@/lib/web3'
import '@rainbow-me/rainbowkit/styles.css'

const queryClient = new QueryClient()

const rainbowKitConfig = getDefaultConfig({
  appName: 'Derivatives DAO',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id',
  chains: [optimism, optimismSepolia, hardhat],
  ssr: true,
})

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
