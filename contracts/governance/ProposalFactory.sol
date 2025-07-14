// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AdvancedGovernance.sol";
import "../interfaces/IRiskManager.sol";
import "../interfaces/IPriceOracle.sol";

/**
 * @title ProposalFactory
 * @dev Factory for creating common governance proposals with templates
 */
contract ProposalFactory {
    
    AdvancedGovernance public governance;
    address public treasury;
    address public riskManager;
    address public priceOracle;
    address public derivativesEngine;

    // Proposal templates
    enum ProposalTemplate {
        UpdateRiskParameters,
        TreasuryTransfer,
        AddMarket,
        UpdateFees,
        EmergencyPause,
        ProtocolUpgrade
    }

    struct RiskParameterUpdate {
        string symbol;
        uint256 initialMarginRatio;
        uint256 maintenanceMarginRatio;
        uint256 liquidationFeeRatio;
        uint256 maxLeverage;
        uint256 maxPositionSize;
    }

    struct TreasuryTransferParams {
        address token;
        address recipient;
        uint256 amount;
        string purpose;
    }

    struct MarketParams {
        string symbol;
        uint256 maxLeverage;
        address priceFeed;
    }

    struct FeeUpdate {
        uint256 tradingFee;
        uint256 fundingFee;
        uint256 liquidationFee;
    }

    // Events
    event ProposalCreatedFromTemplate(
        uint256 indexed proposalId,
        ProposalTemplate template,
        address indexed creator
    );

    constructor(
        address _governance,
        address _treasury,
        address _riskManager,
        address _priceOracle,
        address _derivativesEngine
    ) {
        governance = AdvancedGovernance(_governance);
        treasury = _treasury;
        riskManager = _riskManager;
        priceOracle = _priceOracle;
        derivativesEngine = _derivativesEngine;
    }

    /**
     * @dev Creates a risk parameter update proposal
     */
    function createRiskParameterProposal(
        RiskParameterUpdate calldata params,
        string calldata title,
        string calldata description,
        string calldata ipfsHash
    ) external returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        
        targets[0] = riskManager;
        values[0] = 0;
        calldatas[0] = abi.encodeWithSignature(
            "setRiskParameters(string,(uint256,uint256,uint256,uint256,uint256))",
            params.symbol,
            IRiskManager.RiskParameters({
                initialMarginRatio: params.initialMarginRatio,
                maintenanceMarginRatio: params.maintenanceMarginRatio,
                liquidationFeeRatio: params.liquidationFeeRatio,
                maxLeverage: params.maxLeverage,
                maxPositionSize: params.maxPositionSize
            })
        );
        
        proposalId = governance.proposeWithCategory(
            targets,
            values,
            calldatas,
            title,
            description,
            ipfsHash,
            AdvancedGovernance.ProposalCategory.Parameter
        );
        
        emit ProposalCreatedFromTemplate(proposalId, ProposalTemplate.UpdateRiskParameters, msg.sender);
        return proposalId;
    }

    /**
     * @dev Creates a treasury transfer proposal
     */
    function createTreasuryTransferProposal(
        TreasuryTransferParams calldata params,
        string calldata title,
        string calldata description,
        string calldata ipfsHash
    ) external returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        
        targets[0] = treasury;
        values[0] = 0;
        calldatas[0] = abi.encodeWithSignature(
            "emergencyTransfer(address,address,uint256)",
            params.token,
            params.recipient,
            params.amount
        );
        
        proposalId = governance.proposeWithCategory(
            targets,
            values,
            calldatas,
            title,
            description,
            ipfsHash,
            AdvancedGovernance.ProposalCategory.Treasury
        );
        
        emit ProposalCreatedFromTemplate(proposalId, ProposalTemplate.TreasuryTransfer, msg.sender);
        return proposalId;
    }

    /**
     * @dev Creates an add market proposal
     */
    function createAddMarketProposal(
        MarketParams calldata params,
        string calldata title,
        string calldata description,
        string calldata ipfsHash
    ) external returns (uint256 proposalId) {
        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory calldatas = new bytes[](2);
        
        // Add oracle source
        targets[0] = priceOracle;
        values[0] = 0;
        calldatas[0] = abi.encodeWithSignature(
            "addOracle(address,string,uint256)",
            params.priceFeed,
            params.symbol,
            100
        );
        
        // Add market to derivatives engine
        targets[1] = derivativesEngine;
        values[1] = 0;
        calldatas[1] = abi.encodeWithSignature(
            "addMarket(string,uint256)",
            params.symbol,
            params.maxLeverage
        );
        
        proposalId = governance.proposeWithCategory(
            targets,
            values,
            calldatas,
            title,
            description,
            ipfsHash,
            AdvancedGovernance.ProposalCategory.Protocol
        );
        
        emit ProposalCreatedFromTemplate(proposalId, ProposalTemplate.AddMarket, msg.sender);
        return proposalId;
    }

    /**
     * @dev Creates an emergency pause proposal
     */
    function createEmergencyPauseProposal(
        address targetContract,
        string calldata title,
        string calldata description,
        string calldata ipfsHash
    ) external returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        
        targets[0] = targetContract;
        values[0] = 0;
        calldatas[0] = abi.encodeWithSignature("pause()");
        
        proposalId = governance.proposeWithCategory(
            targets,
            values,
            calldatas,
            title,
            description,
            ipfsHash,
            AdvancedGovernance.ProposalCategory.Emergency
        );
        
        emit ProposalCreatedFromTemplate(proposalId, ProposalTemplate.EmergencyPause, msg.sender);
        return proposalId;
    }

    /**
     * @dev Creates a protocol upgrade proposal
     */
    function createProtocolUpgradeProposal(
        address newImplementation,
        bytes calldata upgradeData,
        string calldata title,
        string calldata description,
        string calldata ipfsHash
    ) external returns (uint256 proposalId) {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        
        targets[0] = newImplementation;
        values[0] = 0;
        calldatas[0] = upgradeData;
        
        proposalId = governance.proposeWithCategory(
            targets,
            values,
            calldatas,
            title,
            description,
            ipfsHash,
            AdvancedGovernance.ProposalCategory.Protocol
        );
        
        emit ProposalCreatedFromTemplate(proposalId, ProposalTemplate.ProtocolUpgrade, msg.sender);
        return proposalId;
    }

    /**
     * @dev Creates a batch proposal with multiple actions
     */
    function createBatchProposal(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata title,
        string calldata description,
        string calldata ipfsHash,
        AdvancedGovernance.ProposalCategory category
    ) external returns (uint256 proposalId) {
        require(targets.length <= 10, "Too many operations");
        require(targets.length == values.length, "Length mismatch");
        require(targets.length == calldatas.length, "Length mismatch");
        
        proposalId = governance.proposeWithCategory(
            targets,
            values,
            calldatas,
            title,
            description,
            ipfsHash,
            category
        );
        
        return proposalId;
    }

    /**
     * @dev Creates a text-only proposal (no execution)
     */
    function createTextProposal(
        string calldata title,
        string calldata description,
        string calldata ipfsHash
    ) external returns (uint256 proposalId) {
        address[] memory targets = new address[](0);
        uint256[] memory values = new uint256[](0);
        bytes[] memory calldatas = new bytes[](0);
        
        proposalId = governance.proposeWithCategory(
            targets,
            values,
            calldatas,
            title,
            description,
            ipfsHash,
            AdvancedGovernance.ProposalCategory.Community
        );
        
        return proposalId;
    }

    /**
     * @dev Gets proposal template information
     */
    function getTemplateInfo(ProposalTemplate template) external pure returns (
        string memory name,
        string memory description,
        AdvancedGovernance.ProposalCategory category
    ) {
        if (template == ProposalTemplate.UpdateRiskParameters) {
            return ("Risk Parameter Update", "Update trading risk parameters", AdvancedGovernance.ProposalCategory.Parameter);
        } else if (template == ProposalTemplate.TreasuryTransfer) {
            return ("Treasury Transfer", "Transfer funds from treasury", AdvancedGovernance.ProposalCategory.Treasury);
        } else if (template == ProposalTemplate.AddMarket) {
            return ("Add Market", "Add new trading market", AdvancedGovernance.ProposalCategory.Protocol);
        } else if (template == ProposalTemplate.UpdateFees) {
            return ("Update Fees", "Update protocol fees", AdvancedGovernance.ProposalCategory.Parameter);
        } else if (template == ProposalTemplate.EmergencyPause) {
            return ("Emergency Pause", "Emergency pause protocol", AdvancedGovernance.ProposalCategory.Emergency);
        } else if (template == ProposalTemplate.ProtocolUpgrade) {
            return ("Protocol Upgrade", "Upgrade protocol contracts", AdvancedGovernance.ProposalCategory.Protocol);
        } else {
            return ("Unknown", "Unknown template", AdvancedGovernance.ProposalCategory.Community);
        }
    }

    /**
     * @dev Validates proposal parameters
     */
    function validateProposal(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) external pure returns (bool isValid, string memory reason) {
        if (targets.length == 0) {
            return (false, "No targets specified");
        }
        
        if (targets.length != values.length || targets.length != calldatas.length) {
            return (false, "Array length mismatch");
        }
        
        if (targets.length > 10) {
            return (false, "Too many operations");
        }
        
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) {
                return (false, "Invalid target address");
            }
        }
        
        return (true, "Valid proposal");
    }

    // Admin functions
    function updateContracts(
        address _treasury,
        address _riskManager,
        address _priceOracle,
        address _derivativesEngine
    ) external {
        require(msg.sender == address(governance), "Only governance");
        
        treasury = _treasury;
        riskManager = _riskManager;
        priceOracle = _priceOracle;
        derivativesEngine = _derivativesEngine;
    }
}
