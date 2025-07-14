export const tradingResolvers = {
  Query: {
    position: async (parent: any, { id }: { id: string }, { dataSources }: any) => {
      return dataSources.subgraphAPI.getPosition(id);
    },

    positions: async (
      parent: any,
      { first, skip, where, orderBy, orderDirection }: any,
      { dataSources }: any
    ) => {
      return dataSources.subgraphAPI.getPositions({
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
    },

    trader: async (parent: any, { id }: { id: string }, { dataSources }: any) => {
      return dataSources.subgraphAPI.getTrader(id);
    },

    traders: async (
      parent: any,
      { first, skip, where, orderBy, orderDirection }: any,
      { dataSources }: any
    ) => {
      return dataSources.subgraphAPI.getTraders({
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
    },

    market: async (parent: any, { id }: { id: string }, { dataSources }: any) => {
      return dataSources.subgraphAPI.getMarket(id);
    },

    markets: async (
      parent: any,
      { first, skip, where, orderBy, orderDirection }: any,
      { dataSources }: any
    ) => {
      return dataSources.subgraphAPI.getMarkets({
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
    },

    trades: async (
      parent: any,
      { first, skip, where, orderBy, orderDirection }: any,
      { dataSources }: any
    ) => {
      return dataSources.subgraphAPI.getTrades({
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
    },

    liquidations: async (
      parent: any,
      { first, skip, where, orderBy, orderDirection }: any,
      { dataSources }: any
    ) => {
      return dataSources.subgraphAPI.getLiquidations({
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
    },

    priceUpdates: async (
      parent: any,
      { first, skip, where, orderBy, orderDirection }: any,
      { dataSources }: any
    ) => {
      return dataSources.subgraphAPI.getPriceUpdates({
        first,
        skip,
        where,
        orderBy,
        orderDirection,
      });
    },

    topTraders: async (
      parent: any,
      { first, metric, timeframe }: any,
      { dataSources, cache }: any
    ) => {
      const cacheKey = `topTraders:${metric}:${timeframe}:${first}`;
      
      // Try to get from cache first
      const cached = await cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Calculate time range based on timeframe
      let timeFilter = {};
      const now = Math.floor(Date.now() / 1000);
      
      switch (timeframe) {
        case 'day':
          timeFilter = { lastTradeAt_gt: (now - 86400).toString() };
          break;
        case 'week':
          timeFilter = { lastTradeAt_gt: (now - 604800).toString() };
          break;
        case 'month':
          timeFilter = { lastTradeAt_gt: (now - 2592000).toString() };
          break;
        case 'allTime':
        default:
          timeFilter = {};
          break;
      }

      // Determine order by based on metric
      let orderBy = 'totalPnL';
      switch (metric) {
        case 'totalVolume':
          orderBy = 'totalVolume';
          break;
        case 'winRate':
          orderBy = 'winRate';
          break;
        case 'totalPositions':
          orderBy = 'totalPositions';
          break;
        case 'totalPnL':
        default:
          orderBy = 'totalPnL';
          break;
      }

      const traders = await dataSources.subgraphAPI.getTraders({
        first,
        skip: 0,
        where: timeFilter,
        orderBy,
        orderDirection: 'desc',
      });

      // Cache for 5 minutes
      await cache.setEx(cacheKey, 300, JSON.stringify(traders));
      
      return traders;
    },

    topLiquidators: async (
      parent: any,
      { first, timeframe }: any,
      { dataSources, cache }: any
    ) => {
      const cacheKey = `topLiquidators:${timeframe}:${first}`;
      
      // Try to get from cache first
      const cached = await cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Calculate time range based on timeframe
      let timeFilter = {};
      const now = Math.floor(Date.now() / 1000);
      
      switch (timeframe) {
        case 'day':
          timeFilter = { lastLiquidationAt_gt: (now - 86400).toString() };
          break;
        case 'week':
          timeFilter = { lastLiquidationAt_gt: (now - 604800).toString() };
          break;
        case 'month':
          timeFilter = { lastLiquidationAt_gt: (now - 2592000).toString() };
          break;
        case 'allTime':
        default:
          timeFilter = {};
          break;
      }

      const liquidators = await dataSources.subgraphAPI.getLiquidators({
        first,
        skip: 0,
        where: timeFilter,
        orderBy: 'totalRewards',
        orderDirection: 'desc',
      });

      // Cache for 5 minutes
      await cache.setEx(cacheKey, 300, JSON.stringify(liquidators));
      
      return liquidators;
    },
  },
};
