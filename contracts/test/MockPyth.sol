// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockPyth
 * @dev Mock Pyth Network contract for testing
 */
contract MockPyth {
    
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint publishTime;
    }

    struct PriceFeed {
        bytes32 id;
        Price price;
        Price emaPrice;
    }

    mapping(bytes32 => Price) public prices;
    mapping(bytes32 => Price) public emaPrices;
    uint256 public updateFee = 1 wei;

    event PriceUpdated(bytes32 indexed id, int64 price, uint64 conf, uint publishTime);

    function getPrice(bytes32 id) external view returns (Price memory price) {
        price = prices[id];
        require(price.publishTime > 0, "Price not found");
        require(block.timestamp - price.publishTime <= 60, "Price too stale");
        return price;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory price) {
        return prices[id];
    }

    function getEmaPrice(bytes32 id) external view returns (Price memory price) {
        price = emaPrices[id];
        require(price.publishTime > 0, "EMA price not found");
        return price;
    }

    function updatePriceFeeds(bytes[] calldata updateData) external payable {
        require(msg.value >= updateFee, "Insufficient fee");
        
        // Mock implementation - in real Pyth, this would parse the update data
        // For testing, we'll just emit an event
        for (uint256 i = 0; i < updateData.length; i++) {
            // Mock processing of update data
        }
    }

    function getUpdateFee(bytes[] calldata updateData) external view returns (uint feeAmount) {
        return updateFee * updateData.length;
    }

    // Test helper functions
    function setPrice(
        bytes32 id,
        int64 price,
        uint64 conf,
        int32 expo,
        uint publishTime
    ) external {
        prices[id] = Price({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: publishTime
        });

        emit PriceUpdated(id, price, conf, publishTime);
    }

    function setEmaPrice(
        bytes32 id,
        int64 price,
        uint64 conf,
        int32 expo,
        uint publishTime
    ) external {
        emaPrices[id] = Price({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: publishTime
        });
    }

    function setUpdateFee(uint256 _fee) external {
        updateFee = _fee;
    }

    function updatePriceWithCurrentTime(
        bytes32 id,
        int64 price,
        uint64 conf,
        int32 expo
    ) external {
        prices[id] = Price({
            price: price,
            conf: conf,
            expo: expo,
            publishTime: block.timestamp
        });

        emit PriceUpdated(id, price, conf, block.timestamp);
    }

    // Batch update for multiple prices
    function batchUpdatePrices(
        bytes32[] calldata ids,
        int64[] calldata priceValues,
        uint64[] calldata confs,
        int32[] calldata expos
    ) external {
        require(ids.length == priceValues.length, "Array length mismatch");
        require(ids.length == confs.length, "Array length mismatch");
        require(ids.length == expos.length, "Array length mismatch");

        for (uint256 i = 0; i < ids.length; i++) {
            prices[ids[i]] = Price({
                price: priceValues[i],
                conf: confs[i],
                expo: expos[i],
                publishTime: block.timestamp
            });

            emit PriceUpdated(ids[i], priceValues[i], confs[i], block.timestamp);
        }
    }
}
