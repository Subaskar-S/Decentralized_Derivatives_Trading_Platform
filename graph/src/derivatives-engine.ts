import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import {
  PositionOpened,
  PositionClosed,
  CollateralAdded,
  CollateralRemoved,
  MarketAdded,
  FundingRateUpdated,
} from "../generated/DerivativesEngine/DerivativesEngine";
import {
  Position,
  Market,
  Trader,
  Trade,
  CollateralUpdate,
  DailyStats,
  HourlyStats,
  ProtocolMetrics,
  FundingRateUpdate,
} from "../generated/schema";
import {
  getOrCreateTrader,
  getOrCreateMarket,
  getOrCreateDailyStats,
  getOrCreateHourlyStats,
  getOrCreateProtocolMetrics,
  updateTraderStats,
  updateMarketStats,
  calculateMarginRatio,
  ZERO_BI,
  ONE_BI,
  ZERO_BD,
  BI_18,
} from "./helpers";

export function handlePositionOpened(event: PositionOpened): void {
  let positionId = event.params.positionId.toHexString();
  let position = new Position(positionId);
  
  // Basic position data
  position.positionId = event.params.positionId;
  position.size = event.params.size;
  position.collateral = event.params.collateral;
  position.entryPrice = event.params.entryPrice;
  position.entryTime = event.block.timestamp;
  position.isLong = event.params.isLong;
  position.fundingIndex = ZERO_BI; // Will be updated by funding rate events
  position.status = "OPEN";
  position.createdAt = event.block.timestamp;
  position.updatedAt = event.block.timestamp;
  position.blockNumber = event.block.number;
  position.transactionHash = event.transaction.hash;
  
  // Calculate liquidation price and margin ratio
  position.liquidationPrice = calculateLiquidationPrice(
    event.params.entryPrice,
    event.params.size,
    event.params.collateral,
    event.params.isLong
  );
  position.marginRatio = calculateMarginRatio(
    event.params.collateral,
    event.params.size,
    event.params.entryPrice
  );
  
  // Get or create related entities
  let trader = getOrCreateTrader(event.params.trader);
  let market = getOrCreateMarket(event.params.symbol);
  
  // Set relationships
  position.trader = trader.id;
  position.market = market.id;
  
  position.save();
  
  // Create trade record
  let tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let trade = new Trade(tradeId);
  trade.trader = trader.id;
  trade.position = position.id;
  trade.market = market.id;
  trade.type = "OPEN";
  trade.size = event.params.size;
  trade.price = event.params.entryPrice;
  trade.collateral = event.params.collateral;
  trade.fee = calculateTradingFee(event.params.size);
  trade.timestamp = event.block.timestamp;
  trade.blockNumber = event.block.number;
  trade.transactionHash = event.transaction.hash;
  trade.gasUsed = event.receipt ? event.receipt!.gasUsed : ZERO_BI;
  trade.gasPrice = event.transaction.gasPrice;
  trade.save();
  
  // Update trader statistics
  updateTraderStats(trader, event.params.size, event.params.collateral, true);
  
  // Update market statistics
  updateMarketStats(market, event.params.size, event.params.isLong, true);
  
  // Update daily and hourly stats
  let dailyStats = getOrCreateDailyStats(event.block.timestamp);
  dailyStats.totalVolume = dailyStats.totalVolume.plus(event.params.size);
  dailyStats.totalTrades = dailyStats.totalTrades.plus(ONE_BI);
  dailyStats.positionsOpened = dailyStats.positionsOpened.plus(ONE_BI);
  dailyStats.totalFees = dailyStats.totalFees.plus(calculateTradingFee(event.params.size));
  dailyStats.save();
  
  let hourlyStats = getOrCreateHourlyStats(event.block.timestamp);
  hourlyStats.volume = hourlyStats.volume.plus(event.params.size);
  hourlyStats.trades = hourlyStats.trades.plus(ONE_BI);
  hourlyStats.positionsOpened = hourlyStats.positionsOpened.plus(ONE_BI);
  hourlyStats.save();
  
  // Update protocol metrics
  let protocolMetrics = getOrCreateProtocolMetrics();
  protocolMetrics.totalVolumeAllTime = protocolMetrics.totalVolumeAllTime.plus(event.params.size);
  protocolMetrics.totalTradesAllTime = protocolMetrics.totalTradesAllTime.plus(ONE_BI);
  protocolMetrics.activePositions = protocolMetrics.activePositions.plus(ONE_BI);
  protocolMetrics.totalValueLocked = protocolMetrics.totalValueLocked.plus(event.params.collateral);
  protocolMetrics.lastUpdated = event.block.timestamp;
  protocolMetrics.blockNumber = event.block.number;
  protocolMetrics.save();
}

export function handlePositionClosed(event: PositionClosed): void {
  let positionId = event.params.positionId.toHexString();
  let position = Position.load(positionId);
  
  if (!position) {
    return; // Position not found
  }
  
  // Update position data
  position.exitPrice = event.params.exitPrice;
  position.exitTime = event.block.timestamp;
  position.pnl = event.params.pnl;
  position.status = "CLOSED";
  position.updatedAt = event.block.timestamp;
  position.save();
  
  // Create trade record
  let tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let trade = new Trade(tradeId);
  trade.trader = position.trader;
  trade.position = position.id;
  trade.market = position.market;
  trade.type = "CLOSE";
  trade.size = position.size;
  trade.price = event.params.exitPrice;
  trade.fee = calculateTradingFee(position.size);
  trade.pnl = event.params.pnl;
  trade.timestamp = event.block.timestamp;
  trade.blockNumber = event.block.number;
  trade.transactionHash = event.transaction.hash;
  trade.gasUsed = event.receipt ? event.receipt!.gasUsed : ZERO_BI;
  trade.gasPrice = event.transaction.gasPrice;
  trade.save();
  
  // Update trader statistics
  let trader = Trader.load(position.trader);
  if (trader) {
    trader.totalPnL = trader.totalPnL.plus(event.params.pnl);
    trader.activePositions = trader.activePositions.minus(ONE_BI);
    trader.totalCollateral = trader.totalCollateral.minus(position.collateral);
    trader.lastTradeAt = event.block.timestamp;
    trader.updatedAt = event.block.timestamp;
    
    // Update win rate
    if (event.params.pnl.gt(ZERO_BI)) {
      // Winning trade - update win rate calculation
      let totalClosedPositions = trader.totalPositions.minus(trader.activePositions);
      if (totalClosedPositions.gt(ZERO_BI)) {
        // This is a simplified win rate calculation
        trader.winRate = trader.winRate.plus(BigDecimal.fromString("1").div(totalClosedPositions.toBigDecimal()));
      }
    }
    
    trader.save();
  }
  
  // Update market statistics
  let market = Market.load(position.market);
  if (market) {
    updateMarketStats(market, position.size, position.isLong, false);
  }
  
  // Update daily and hourly stats
  let dailyStats = getOrCreateDailyStats(event.block.timestamp);
  dailyStats.totalVolume = dailyStats.totalVolume.plus(position.size);
  dailyStats.totalTrades = dailyStats.totalTrades.plus(ONE_BI);
  dailyStats.positionsClosed = dailyStats.positionsClosed.plus(ONE_BI);
  dailyStats.totalFees = dailyStats.totalFees.plus(calculateTradingFee(position.size));
  dailyStats.save();
  
  let hourlyStats = getOrCreateHourlyStats(event.block.timestamp);
  hourlyStats.volume = hourlyStats.volume.plus(position.size);
  hourlyStats.trades = hourlyStats.trades.plus(ONE_BI);
  hourlyStats.positionsClosed = hourlyStats.positionsClosed.plus(ONE_BI);
  hourlyStats.save();
  
  // Update protocol metrics
  let protocolMetrics = getOrCreateProtocolMetrics();
  protocolMetrics.totalVolumeAllTime = protocolMetrics.totalVolumeAllTime.plus(position.size);
  protocolMetrics.totalTradesAllTime = protocolMetrics.totalTradesAllTime.plus(ONE_BI);
  protocolMetrics.activePositions = protocolMetrics.activePositions.minus(ONE_BI);
  protocolMetrics.totalValueLocked = protocolMetrics.totalValueLocked.minus(position.collateral);
  protocolMetrics.lastUpdated = event.block.timestamp;
  protocolMetrics.blockNumber = event.block.number;
  protocolMetrics.save();
}

export function handleCollateralAdded(event: CollateralAdded): void {
  let positionId = event.params.positionId.toHexString();
  let position = Position.load(positionId);
  
  if (!position) {
    return;
  }
  
  // Create collateral update record
  let updateId = positionId + "-" + event.block.timestamp.toString();
  let collateralUpdate = new CollateralUpdate(updateId);
  collateralUpdate.position = position.id;
  collateralUpdate.trader = position.trader;
  collateralUpdate.oldCollateral = event.params.oldCollateral;
  collateralUpdate.newCollateral = event.params.newCollateral;
  collateralUpdate.collateralDelta = event.params.newCollateral.minus(event.params.oldCollateral);
  collateralUpdate.type = "ADD";
  collateralUpdate.timestamp = event.block.timestamp;
  collateralUpdate.blockNumber = event.block.number;
  collateralUpdate.transactionHash = event.transaction.hash;
  collateralUpdate.save();
  
  // Update position
  position.collateral = event.params.newCollateral;
  position.marginRatio = calculateMarginRatio(
    event.params.newCollateral,
    position.size,
    position.entryPrice
  );
  position.updatedAt = event.block.timestamp;
  position.save();
  
  // Create trade record
  let tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let trade = new Trade(tradeId);
  trade.trader = position.trader;
  trade.position = position.id;
  trade.market = position.market;
  trade.type = "ADD_COLLATERAL";
  trade.size = ZERO_BI;
  trade.price = ZERO_BI;
  trade.collateral = collateralUpdate.collateralDelta;
  trade.fee = ZERO_BI;
  trade.timestamp = event.block.timestamp;
  trade.blockNumber = event.block.number;
  trade.transactionHash = event.transaction.hash;
  trade.save();
}

export function handleCollateralRemoved(event: CollateralRemoved): void {
  let positionId = event.params.positionId.toHexString();
  let position = Position.load(positionId);
  
  if (!position) {
    return;
  }
  
  // Create collateral update record
  let updateId = positionId + "-" + event.block.timestamp.toString();
  let collateralUpdate = new CollateralUpdate(updateId);
  collateralUpdate.position = position.id;
  collateralUpdate.trader = position.trader;
  collateralUpdate.oldCollateral = event.params.oldCollateral;
  collateralUpdate.newCollateral = event.params.newCollateral;
  collateralUpdate.collateralDelta = event.params.oldCollateral.minus(event.params.newCollateral);
  collateralUpdate.type = "REMOVE";
  collateralUpdate.timestamp = event.block.timestamp;
  collateralUpdate.blockNumber = event.block.number;
  collateralUpdate.transactionHash = event.transaction.hash;
  collateralUpdate.save();
  
  // Update position
  position.collateral = event.params.newCollateral;
  position.marginRatio = calculateMarginRatio(
    event.params.newCollateral,
    position.size,
    position.entryPrice
  );
  position.updatedAt = event.block.timestamp;
  position.save();
  
  // Create trade record
  let tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let trade = new Trade(tradeId);
  trade.trader = position.trader;
  trade.position = position.id;
  trade.market = position.market;
  trade.type = "REMOVE_COLLATERAL";
  trade.size = ZERO_BI;
  trade.price = ZERO_BI;
  trade.collateral = collateralUpdate.collateralDelta.neg();
  trade.fee = ZERO_BI;
  trade.timestamp = event.block.timestamp;
  trade.blockNumber = event.block.number;
  trade.transactionHash = event.transaction.hash;
  trade.save();
}

export function handleMarketAdded(event: MarketAdded): void {
  let market = getOrCreateMarket(event.params.symbol);
  market.maxLeverage = event.params.maxLeverage;
  market.isActive = true;
  market.updatedAt = event.block.timestamp;
  market.save();
}

export function handleFundingRateUpdated(event: FundingRateUpdated): void {
  let market = getOrCreateMarket(event.params.symbol);
  market.fundingRate = event.params.newRate;
  market.lastFundingTime = event.block.timestamp;
  market.updatedAt = event.block.timestamp;
  market.save();
  
  // Create funding rate update record
  let updateId = event.params.symbol + "-" + event.block.timestamp.toString();
  let fundingUpdate = new FundingRateUpdate(updateId);
  fundingUpdate.market = market.id;
  fundingUpdate.fundingRate = event.params.newRate;
  fundingUpdate.openInterestLong = market.openInterestLong;
  fundingUpdate.openInterestShort = market.openInterestShort;
  fundingUpdate.timestamp = event.block.timestamp;
  fundingUpdate.blockNumber = event.block.number;
  fundingUpdate.save();
}

// Helper functions
function calculateLiquidationPrice(
  entryPrice: BigInt,
  size: BigInt,
  collateral: BigInt,
  isLong: boolean
): BigInt {
  // Simplified liquidation price calculation
  // In production, this would use the actual risk parameters
  let maintenanceMargin = BigDecimal.fromString("0.06"); // 6%
  let collateralRatio = collateral.toBigDecimal().div(size.toBigDecimal());
  
  if (isLong) {
    let liquidationRatio = BigDecimal.fromString("1").minus(collateralRatio.minus(maintenanceMargin));
    return entryPrice.toBigDecimal().times(liquidationRatio).truncate(0).digits;
  } else {
    let liquidationRatio = BigDecimal.fromString("1").plus(collateralRatio.minus(maintenanceMargin));
    return entryPrice.toBigDecimal().times(liquidationRatio).truncate(0).digits;
  }
}

function calculateTradingFee(size: BigInt): BigInt {
  // 0.1% trading fee
  return size.div(BigInt.fromI32(1000));
}
