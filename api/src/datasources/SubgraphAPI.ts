import { GraphQLClient } from 'graphql-request';
import { logger } from '../utils/logger';

export class SubgraphAPI {
  private client: GraphQLClient;
  private cache: any;

  constructor(subgraphUrl: string, cache: any) {
    this.client = new GraphQLClient(subgraphUrl, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.cache = cache;
  }

  // Position queries
  async getPosition(id: string) {
    const query = `
      query GetPosition($id: ID!) {
        position(id: $id) {
          id
          positionId
          trader { id address }
          market { id symbol }
          size
          collateral
          entryPrice
          exitPrice
          entryTime
          exitTime
          isLong
          fundingIndex
          pnl
          status
          liquidationPrice
          marginRatio
          createdAt
          updatedAt
          blockNumber
          transactionHash
        }
      }
    `;

    try {
      const result = await this.client.request(query, { id });
      return result.position;
    } catch (error) {
      logger.error('Error fetching position:', error);
      throw error;
    }
  }

  async getPositions(params: any) {
    const { first = 10, skip = 0, where = {}, orderBy = 'createdAt', orderDirection = 'desc' } = params;
    
    const query = `
      query GetPositions(
        $first: Int!
        $skip: Int!
        $where: Position_filter
        $orderBy: Position_orderBy!
        $orderDirection: OrderDirection!
      ) {
        positions(
          first: $first
          skip: $skip
          where: $where
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          id
          positionId
          trader { id address }
          market { id symbol }
          size
          collateral
          entryPrice
          exitPrice
          entryTime
          exitTime
          isLong
          fundingIndex
          pnl
          status
          liquidationPrice
          marginRatio
          createdAt
          updatedAt
        }
      }
    `;

    try {
      const result = await this.client.request(query, {
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
      return result.positions;
    } catch (error) {
      logger.error('Error fetching positions:', error);
      throw error;
    }
  }

  // Trader queries
  async getTrader(id: string) {
    const cacheKey = `trader:${id}`;
    
    // Try cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      query GetTrader($id: ID!) {
        trader(id: $id) {
          id
          address
          totalPositions
          activePositions
          totalVolume
          totalPnL
          totalCollateral
          winRate
          averageHoldTime
          riskScore
          liquidationCount
          marginCallCount
          firstTradeAt
          lastTradeAt
          createdAt
          updatedAt
        }
      }
    `;

    try {
      const result = await this.client.request(query, { id });
      
      // Cache for 1 minute
      if (result.trader) {
        await this.cache.setEx(cacheKey, 60, JSON.stringify(result.trader));
      }
      
      return result.trader;
    } catch (error) {
      logger.error('Error fetching trader:', error);
      throw error;
    }
  }

  async getTraders(params: any) {
    const { first = 10, skip = 0, where = {}, orderBy = 'totalVolume', orderDirection = 'desc' } = params;
    
    const query = `
      query GetTraders(
        $first: Int!
        $skip: Int!
        $where: Trader_filter
        $orderBy: Trader_orderBy!
        $orderDirection: OrderDirection!
      ) {
        traders(
          first: $first
          skip: $skip
          where: $where
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          id
          address
          totalPositions
          activePositions
          totalVolume
          totalPnL
          totalCollateral
          winRate
          averageHoldTime
          riskScore
          liquidationCount
          marginCallCount
          firstTradeAt
          lastTradeAt
          createdAt
          updatedAt
        }
      }
    `;

    try {
      const result = await this.client.request(query, {
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
      return result.traders;
    } catch (error) {
      logger.error('Error fetching traders:', error);
      throw error;
    }
  }

  // Market queries
  async getMarket(id: string) {
    const cacheKey = `market:${id}`;
    
    // Try cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      query GetMarket($id: ID!) {
        market(id: $id) {
          id
          symbol
          maxLeverage
          fundingRate
          lastFundingTime
          openInterestLong
          openInterestShort
          isActive
          totalVolume
          totalTrades
          totalPositions
          activePositions
          currentPrice
          createdAt
          updatedAt
        }
      }
    `;

    try {
      const result = await this.client.request(query, { id });
      
      // Cache for 30 seconds
      if (result.market) {
        await this.cache.setEx(cacheKey, 30, JSON.stringify(result.market));
      }
      
      return result.market;
    } catch (error) {
      logger.error('Error fetching market:', error);
      throw error;
    }
  }

  async getMarkets(params: any) {
    const { first = 10, skip = 0, where = {}, orderBy = 'totalVolume', orderDirection = 'desc' } = params;
    
    const query = `
      query GetMarkets(
        $first: Int!
        $skip: Int!
        $where: Market_filter
        $orderBy: Market_orderBy!
        $orderDirection: OrderDirection!
      ) {
        markets(
          first: $first
          skip: $skip
          where: $where
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          id
          symbol
          maxLeverage
          fundingRate
          lastFundingTime
          openInterestLong
          openInterestShort
          isActive
          totalVolume
          totalTrades
          totalPositions
          activePositions
          currentPrice
          createdAt
          updatedAt
        }
      }
    `;

    try {
      const result = await this.client.request(query, {
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
      return result.markets;
    } catch (error) {
      logger.error('Error fetching markets:', error);
      throw error;
    }
  }

  // Trade queries
  async getTrades(params: any) {
    const { first = 10, skip = 0, where = {}, orderBy = 'timestamp', orderDirection = 'desc' } = params;
    
    const query = `
      query GetTrades(
        $first: Int!
        $skip: Int!
        $where: Trade_filter
        $orderBy: Trade_orderBy!
        $orderDirection: OrderDirection!
      ) {
        trades(
          first: $first
          skip: $skip
          where: $where
          orderBy: $orderBy
          orderDirection: $orderDirection
        ) {
          id
          trader { id address }
          position { id }
          market { id symbol }
          type
          size
          price
          collateral
          fee
          pnl
          timestamp
          blockNumber
          transactionHash
          gasUsed
          gasPrice
        }
      }
    `;

    try {
      const result = await this.client.request(query, {
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
      return result.trades;
    } catch (error) {
      logger.error('Error fetching trades:', error);
      throw error;
    }
  }

  // Protocol metrics
  async getProtocolMetrics() {
    const cacheKey = 'protocolMetrics';
    
    // Try cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const query = `
      query GetProtocolMetrics {
        protocolMetrics(id: "protocol-metrics") {
          id
          totalVolumeAllTime
          totalTradesAllTime
          totalFeesAllTime
          totalTradersAllTime
          totalValueLocked
          totalOpenInterest
          activePositions
          activeTraders
          totalLiquidations
          insuranceFundBalance
          averageMarginRatio
          totalProposals
          totalVotes
          governanceParticipation
          lastUpdated
          blockNumber
        }
      }
    `;

    try {
      const result = await this.client.request(query);
      
      // Cache for 30 seconds
      if (result.protocolMetrics) {
        await this.cache.setEx(cacheKey, 30, JSON.stringify(result.protocolMetrics));
      }
      
      return result.protocolMetrics;
    } catch (error) {
      logger.error('Error fetching protocol metrics:', error);
      throw error;
    }
  }

  // Helper methods for related data
  async getTradesByTrader(traderId: string, params: any = {}) {
    return this.getTrades({
      ...params,
      where: { ...params.where, trader: traderId },
    });
  }

  async getPositionsByTrader(traderId: string, params: any = {}) {
    return this.getPositions({
      ...params,
      where: { ...params.where, trader: traderId },
    });
  }

  async getTradesByMarket(marketId: string, params: any = {}) {
    return this.getTrades({
      ...params,
      where: { ...params.where, market: marketId },
    });
  }

  async getPositionsByMarket(marketId: string, params: any = {}) {
    return this.getPositions({
      ...params,
      where: { ...params.where, market: marketId },
    });
  }

  // Quick access methods for popular queries
  async getRecentTrades(limit: number = 50) {
    return this.getTrades({
      first: limit,
      orderBy: 'timestamp',
      orderDirection: 'desc',
    });
  }

  async getTopTraders(limit: number = 10) {
    return this.getTraders({
      first: limit,
      orderBy: 'totalPnL',
      orderDirection: 'desc',
    });
  }

  async getDailyStats(days: number = 30) {
    const query = `
      query GetDailyStats($first: Int!) {
        dailyStats(
          first: $first
          orderBy: timestamp
          orderDirection: desc
        ) {
          id
          date
          totalVolume
          totalTrades
          totalFees
          activeTraders
          newTraders
          positionsOpened
          positionsClosed
          liquidations
          totalOpenInterest
          averageLeverage
          averagePrice
          priceVolatility
          proposalsCreated
          votescast
          timestamp
          blockNumber
        }
      }
    `;

    try {
      const result = await this.client.request(query, { first: days });
      return result.dailyStats;
    } catch (error) {
      logger.error('Error fetching daily stats:', error);
      throw error;
    }
  }
}
