// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPyth
 * @dev Pyth Network Interface
 */
interface IPyth {
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

    function getPrice(bytes32 id) external view returns (Price memory price);
    function getPriceUnsafe(bytes32 id) external view returns (Price memory price);
    function getEmaPrice(bytes32 id) external view returns (Price memory price);
    function updatePriceFeeds(bytes[] calldata updateData) external payable;
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint feeAmount);
}
