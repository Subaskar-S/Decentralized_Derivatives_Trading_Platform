import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import {
  Trader,
  Market,
  DailyStats,
  HourlyStats,
  ProtocolMetrics,
  GovernanceToken,
  TokenHolder,
} from "../generated/schema";

// Constants
export let ZERO_BI = BigInt.fromI32(0);
export let ONE_BI = BigInt.fromI32(1);
export let ZERO_BD = BigDecimal.fromString("0");
export let ONE_BD = BigDecimal.fromString("1");
export let BI_18 = BigInt.fromI32(18);

// Date helpers
export function getDayId(timestamp: BigInt): string {
  let dayTimestamp = timestamp.toI32() / 86400;
  return dayTimestamp.toString();
}

export function getHourId(timestamp: BigInt): string {
  let hourTimestamp = timestamp.toI32() / 3600;
  return hourTimestamp.toString();
}

export function formatDate(timestamp: BigInt): string {
  let date = new Date(timestamp.toI32() * 1000);
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth() + 1;
  let day = date.getUTCDate();
  
  let monthStr = month < 10 ? "0" + month.toString() : month.toString();
  let dayStr = day < 10 ? "0" + day.toString() : day.toString();
  
  return year.toString() + "-" + monthStr + "-" + dayStr;
}

// Entity creation helpers
export function getOrCreateTrader(address: Address): Trader {
  let trader = Trader.load(address.toHexString());
  
  if (!trader) {
    trader = new Trader(address.toHexString());
    trader.address = address;
    trader.totalPositions = ZERO_BI;
    trader.activePositions = ZERO_BI;
    trader.totalVolume = ZERO_BI;
    trader.totalPnL = ZERO_BI;
    trader.totalCollateral = ZERO_BI;
    trader.winRate = ZERO_BD;
    trader.averageHoldTime = ZERO_BI;
    trader.riskScore = ZERO_BI;
    trader.liquidationCount = ZERO_BI;
    trader.marginCallCount = ZERO_BI;
    trader.firstTradeAt = ZERO_BI;
    trader.lastTradeAt = ZERO_BI;
    trader.createdAt = ZERO_BI;
    trader.updatedAt = ZERO_BI;
  }
  
  return trader;
}

export function getOrCreateMarket(symbol: string): Market {
  let market = Market.load(symbol);
  
  if (!market) {
    market = new Market(symbol);
    market.symbol = symbol;
    market.maxLeverage = ZERO_BI;
    market.fundingRate = ZERO_BI;
    market.lastFundingTime = ZERO_BI;
    market.openInterestLong = ZERO_BI;
    market.openInterestShort = ZERO_BI;
    market.isActive = false;
    market.totalVolume = ZERO_BI;
    market.totalTrades = ZERO_BI;
    market.totalPositions = ZERO_BI;
    market.activePositions = ZERO_BI;
    market.currentPrice = ZERO_BI;
    market.createdAt = ZERO_BI;
    market.updatedAt = ZERO_BI;
  }
  
  return market;
}

export function getOrCreateDailyStats(timestamp: BigInt): DailyStats {
  let dayId = getDayId(timestamp);
  let dailyStats = DailyStats.load(dayId);
  
  if (!dailyStats) {
    dailyStats = new DailyStats(dayId);
    dailyStats.date = formatDate(timestamp);
    dailyStats.totalVolume = ZERO_BI;
    dailyStats.totalTrades = ZERO_BI;
    dailyStats.totalFees = ZERO_BI;
    dailyStats.activeTraders = ZERO_BI;
    dailyStats.newTraders = ZERO_BI;
    dailyStats.positionsOpened = ZERO_BI;
    dailyStats.positionsClosed = ZERO_BI;
    dailyStats.liquidations = ZERO_BI;
    dailyStats.totalOpenInterest = ZERO_BI;
    dailyStats.averageLeverage = ZERO_BD;
    dailyStats.averagePrice = ZERO_BI;
    dailyStats.priceVolatility = ZERO_BD;
    dailyStats.proposalsCreated = ZERO_BI;
    dailyStats.votescast = ZERO_BI;
    dailyStats.timestamp = timestamp;
    dailyStats.blockNumber = ZERO_BI;
  }
  
  return dailyStats;
}

export function getOrCreateHourlyStats(timestamp: BigInt): HourlyStats {
  let hourId = getHourId(timestamp);
  let hourlyStats = HourlyStats.load(hourId);
  
  if (!hourlyStats) {
    hourlyStats = new HourlyStats(hourId);
    hourlyStats.hour = BigInt.fromI32(timestamp.toI32() / 3600);
    hourlyStats.volume = ZERO_BI;
    hourlyStats.trades = ZERO_BI;
    hourlyStats.fees = ZERO_BI;
    hourlyStats.positionsOpened = ZERO_BI;
    hourlyStats.positionsClosed = ZERO_BI;
    hourlyStats.liquidations = ZERO_BI;
    hourlyStats.openInterest = ZERO_BI;
    hourlyStats.fundingRate = ZERO_BI;
    hourlyStats.openPrice = ZERO_BI;
    hourlyStats.closePrice = ZERO_BI;
    hourlyStats.highPrice = ZERO_BI;
    hourlyStats.lowPrice = ZERO_BI;
    hourlyStats.timestamp = timestamp;
    hourlyStats.blockNumber = ZERO_BI;
  }
  
  return hourlyStats;
}

export function getOrCreateProtocolMetrics(): ProtocolMetrics {
  let protocolMetrics = ProtocolMetrics.load("protocol-metrics");
  
  if (!protocolMetrics) {
    protocolMetrics = new ProtocolMetrics("protocol-metrics");
    protocolMetrics.totalVolumeAllTime = ZERO_BI;
    protocolMetrics.totalTradesAllTime = ZERO_BI;
    protocolMetrics.totalFeesAllTime = ZERO_BI;
    protocolMetrics.totalTradersAllTime = ZERO_BI;
    protocolMetrics.totalValueLocked = ZERO_BI;
    protocolMetrics.totalOpenInterest = ZERO_BI;
    protocolMetrics.activePositions = ZERO_BI;
    protocolMetrics.activeTraders = ZERO_BI;
    protocolMetrics.totalLiquidations = ZERO_BI;
    protocolMetrics.insuranceFundBalance = ZERO_BI;
    protocolMetrics.averageMarginRatio = ZERO_BD;
    protocolMetrics.totalProposals = ZERO_BI;
    protocolMetrics.totalVotes = ZERO_BI;
    protocolMetrics.governanceParticipation = ZERO_BD;
    protocolMetrics.lastUpdated = ZERO_BI;
    protocolMetrics.blockNumber = ZERO_BI;
  }
  
  return protocolMetrics;
}

export function getOrCreateGovernanceToken(): GovernanceToken {
  let governanceToken = GovernanceToken.load("governance-token");
  
  if (!governanceToken) {
    governanceToken = new GovernanceToken("governance-token");
    governanceToken.totalSupply = ZERO_BI;
    governanceToken.totalHolders = ZERO_BI;
    governanceToken.totalDelegates = ZERO_BI;
    governanceToken.createdAt = ZERO_BI;
    governanceToken.updatedAt = ZERO_BI;
  }
  
  return governanceToken;
}

export function getOrCreateTokenHolder(address: Address): TokenHolder {
  let holder = TokenHolder.load(address.toHexString());
  
  if (!holder) {
    holder = new TokenHolder(address.toHexString());
    holder.address = address;
    holder.balance = ZERO_BI;
    holder.votingPower = ZERO_BI;
    holder.firstTransferAt = ZERO_BI;
    holder.lastTransferAt = ZERO_BI;
  }
  
  return holder;
}

// Update functions
export function updateTraderStats(
  trader: Trader,
  volume: BigInt,
  collateral: BigInt,
  isNewPosition: boolean
): void {
  trader.totalVolume = trader.totalVolume.plus(volume);
  trader.totalCollateral = trader.totalCollateral.plus(collateral);
  
  if (isNewPosition) {
    trader.totalPositions = trader.totalPositions.plus(ONE_BI);
    trader.activePositions = trader.activePositions.plus(ONE_BI);
    
    if (trader.firstTradeAt.equals(ZERO_BI)) {
      trader.firstTradeAt = trader.updatedAt;
    }
  }
  
  trader.save();
}

export function updateMarketStats(
  market: Market,
  size: BigInt,
  isLong: boolean,
  isNewPosition: boolean
): void {
  market.totalVolume = market.totalVolume.plus(size);
  
  if (isNewPosition) {
    market.totalTrades = market.totalTrades.plus(ONE_BI);
    market.totalPositions = market.totalPositions.plus(ONE_BI);
    market.activePositions = market.activePositions.plus(ONE_BI);
    
    if (isLong) {
      market.openInterestLong = market.openInterestLong.plus(size);
    } else {
      market.openInterestShort = market.openInterestShort.plus(size);
    }
  } else {
    // Position closing
    market.activePositions = market.activePositions.minus(ONE_BI);
    
    if (isLong) {
      market.openInterestLong = market.openInterestLong.minus(size);
    } else {
      market.openInterestShort = market.openInterestShort.minus(size);
    }
  }
  
  market.save();
}

// Calculation helpers
export function calculateMarginRatio(
  collateral: BigInt,
  size: BigInt,
  entryPrice: BigInt
): BigDecimal {
  if (size.equals(ZERO_BI)) {
    return ZERO_BD;
  }
  
  let collateralDecimal = collateral.toBigDecimal();
  let sizeDecimal = size.toBigDecimal();
  
  return collateralDecimal.div(sizeDecimal);
}

export function calculateLeverage(
  size: BigInt,
  collateral: BigInt
): BigDecimal {
  if (collateral.equals(ZERO_BI)) {
    return ZERO_BD;
  }
  
  let sizeDecimal = size.toBigDecimal();
  let collateralDecimal = collateral.toBigDecimal();
  
  return sizeDecimal.div(collateralDecimal);
}

export function calculatePnL(
  entryPrice: BigInt,
  exitPrice: BigInt,
  size: BigInt,
  isLong: boolean
): BigInt {
  let priceDiff: BigInt;
  
  if (isLong) {
    priceDiff = exitPrice.minus(entryPrice);
  } else {
    priceDiff = entryPrice.minus(exitPrice);
  }
  
  // PnL = (price difference / entry price) * size
  return priceDiff.times(size).div(entryPrice);
}

export function calculateFundingPayment(
  size: BigInt,
  fundingRate: BigInt,
  timeElapsed: BigInt,
  isLong: boolean
): BigInt {
  // Funding payment = size * funding rate * time elapsed / funding interval
  let fundingInterval = BigInt.fromI32(3600); // 1 hour
  let payment = size.times(fundingRate).times(timeElapsed).div(fundingInterval);
  
  // Long positions pay positive funding rates, short positions receive them
  return isLong ? payment.neg() : payment;
}

// Validation helpers
export function isValidAddress(address: Address): boolean {
  return !address.equals(Address.zero());
}

export function isValidAmount(amount: BigInt): boolean {
  return amount.gt(ZERO_BI);
}

// String helpers
export function concatenateStrings(a: string, b: string): string {
  return a.concat("-").concat(b);
}

export function addressToString(address: Address): string {
  return address.toHexString();
}

// Math helpers
export function min(a: BigInt, b: BigInt): BigInt {
  return a.lt(b) ? a : b;
}

export function max(a: BigInt, b: BigInt): BigInt {
  return a.gt(b) ? a : b;
}

export function abs(value: BigInt): BigInt {
  return value.lt(ZERO_BI) ? value.neg() : value;
}

export function percentage(numerator: BigInt, denominator: BigInt): BigDecimal {
  if (denominator.equals(ZERO_BI)) {
    return ZERO_BD;
  }
  
  return numerator.toBigDecimal().div(denominator.toBigDecimal()).times(BigDecimal.fromString("100"));
}
