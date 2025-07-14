import { GraphQLScalarType } from 'graphql';
import { Kind } from 'graphql/language';
import { tradingResolvers } from './trading';
import { governanceResolvers } from './governance';
import { analyticsResolvers } from './analytics';
import { searchResolvers } from './search';

// Custom scalar types
const BigIntType = new GraphQLScalarType({
  name: 'BigInt',
  description: 'BigInt custom scalar type',
  serialize(value: any) {
    return value.toString();
  },
  parseValue(value: any) {
    return value.toString();
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.INT || ast.kind === Kind.STRING) {
      return ast.value;
    }
    return null;
  },
});

const BigDecimalType = new GraphQLScalarType({
  name: 'BigDecimal',
  description: 'BigDecimal custom scalar type',
  serialize(value: any) {
    return value.toString();
  },
  parseValue(value: any) {
    return value.toString();
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.FLOAT || ast.kind === Kind.STRING) {
      return ast.value;
    }
    return null;
  },
});

const BytesType = new GraphQLScalarType({
  name: 'Bytes',
  description: 'Bytes custom scalar type',
  serialize(value: any) {
    return value.toString();
  },
  parseValue(value: any) {
    return value.toString();
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return ast.value;
    }
    return null;
  },
});

export const resolvers = {
  // Custom scalars
  BigInt: BigIntType,
  BigDecimal: BigDecimalType,
  Bytes: BytesType,

  Query: {
    // Trading queries
    ...tradingResolvers.Query,
    
    // Governance queries
    ...governanceResolvers.Query,
    
    // Analytics queries
    ...analyticsResolvers.Query,
    
    // Search queries
    ...searchResolvers.Query,
  },

  // Type resolvers
  Position: {
    trader: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getTrader(parent.trader);
    },
    market: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getMarket(parent.market);
    },
    trades: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getTradesByPosition(parent.id);
    },
    liquidations: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getLiquidationsByPosition(parent.id);
    },
    collateralUpdates: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getCollateralUpdatesByPosition(parent.id);
    },
  },

  Trader: {
    positions: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getPositionsByTrader(parent.id, args);
    },
    trades: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getTradesByTrader(parent.id, args);
    },
    liquidations: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getLiquidationsByTrader(parent.id, args);
    },
  },

  Market: {
    positions: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getPositionsByMarket(parent.id, args);
    },
    trades: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getTradesByMarket(parent.id, args);
    },
    priceHistory: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getPriceHistory(parent.id, args);
    },
    fundingRateUpdates: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getFundingRateUpdates(parent.id, args);
    },
  },

  Trade: {
    trader: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getTrader(parent.trader);
    },
    position: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getPosition(parent.position);
    },
    market: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getMarket(parent.market);
    },
  },

  Liquidation: {
    position: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getPosition(parent.position);
    },
    trader: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getTrader(parent.trader);
    },
    liquidator: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getLiquidator(parent.liquidator);
    },
  },

  Proposal: {
    votes: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getVotesByProposal(parent.id, args);
    },
  },

  Vote: {
    proposal: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getProposal(parent.proposal);
    },
  },

  Liquidator: {
    liquidations: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getLiquidationsByLiquidator(parent.id, args);
    },
  },

  PriceUpdate: {
    market: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getMarket(parent.market);
    },
  },

  FundingRateUpdate: {
    market: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getMarket(parent.market);
    },
  },

  CollateralUpdate: {
    position: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getPosition(parent.position);
    },
    trader: async (parent: any, args: any, { dataSources }: any) => {
      return dataSources.subgraphAPI.getTrader(parent.trader);
    },
  },
};
