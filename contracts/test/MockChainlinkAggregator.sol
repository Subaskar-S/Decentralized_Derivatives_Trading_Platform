// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockChainlinkAggregator
 * @dev Mock Chainlink price feed for testing
 */
contract MockChainlinkAggregator {
    
    struct RoundData {
        uint80 roundId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    uint8 public decimals;
    string public description;
    uint256 public version;
    
    mapping(uint80 => RoundData) public rounds;
    uint80 public latestRoundId;
    
    constructor(
        uint8 _decimals,
        string memory _description,
        uint256 _version
    ) {
        decimals = _decimals;
        description = _description;
        version = _version;
        latestRoundId = 1;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        RoundData memory round = rounds[latestRoundId];
        return (
            round.roundId,
            round.answer,
            round.startedAt,
            round.updatedAt,
            round.answeredInRound
        );
    }

    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        RoundData memory round = rounds[_roundId];
        return (
            round.roundId,
            round.answer,
            round.startedAt,
            round.updatedAt,
            round.answeredInRound
        );
    }

    // Test helper functions
    function updateAnswer(int256 _answer) external {
        latestRoundId++;
        rounds[latestRoundId] = RoundData({
            roundId: latestRoundId,
            answer: _answer,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: latestRoundId
        });
    }

    function updateAnswerWithTimestamp(int256 _answer, uint256 _timestamp) external {
        latestRoundId++;
        rounds[latestRoundId] = RoundData({
            roundId: latestRoundId,
            answer: _answer,
            startedAt: _timestamp,
            updatedAt: _timestamp,
            answeredInRound: latestRoundId
        });
    }

    function setRoundData(
        uint80 _roundId,
        int256 _answer,
        uint256 _startedAt,
        uint256 _updatedAt
    ) external {
        rounds[_roundId] = RoundData({
            roundId: _roundId,
            answer: _answer,
            startedAt: _startedAt,
            updatedAt: _updatedAt,
            answeredInRound: _roundId
        });
        
        if (_roundId > latestRoundId) {
            latestRoundId = _roundId;
        }
    }
}
