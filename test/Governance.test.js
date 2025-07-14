const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("DAO Governance System", function () {
  // Test fixture for governance deployment
  async function deployGovernanceFixture() {
    const [owner, proposer, voter1, voter2, voter3, guardian, treasury] = await ethers.getSigners();

    // Deploy governance token
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const governanceToken = await GovernanceToken.deploy(treasury.address, owner.address);
    await governanceToken.waitForDeployment();

    // Deploy advanced governance
    const AdvancedGovernance = await ethers.getContractFactory("AdvancedGovernance");
    const governance = await AdvancedGovernance.deploy(
      governanceToken.target,
      guardian.address
    );
    await governance.waitForDeployment();

    // Deploy treasury
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasuryContract = await Treasury.deploy(
      governance.target,
      ethers.ZeroAddress, // staking rewards pool
      ethers.ZeroAddress, // development fund
      ethers.ZeroAddress, // marketing fund
      ethers.ZeroAddress, // insurance fund
      ethers.ZeroAddress  // buyback contract
    );
    await treasuryContract.waitForDeployment();

    // Deploy proposal factory
    const ProposalFactory = await ethers.getContractFactory("ProposalFactory");
    const proposalFactory = await ProposalFactory.deploy(
      governance.target,
      treasuryContract.target,
      ethers.ZeroAddress, // risk manager
      ethers.ZeroAddress, // price oracle
      ethers.ZeroAddress  // derivatives engine
    );
    await proposalFactory.waitForDeployment();

    // Deploy mock ERC20 for testing
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockERC20.deploy("Mock Token", "MOCK", ethers.parseEther("1000000"));

    // Enable trading and mint tokens for testing
    await governanceToken.enableTrading();
    await governanceToken.mintCommunityRewards(proposer.address, ethers.parseEther("300000"));
    await governanceToken.mintCommunityRewards(voter1.address, ethers.parseEther("200000"));
    await governanceToken.mintCommunityRewards(voter2.address, ethers.parseEther("150000"));
    await governanceToken.mintCommunityRewards(voter3.address, ethers.parseEther("100000"));

    // Delegate voting power to self for all voters
    await governanceToken.connect(proposer).delegate(proposer.address);
    await governanceToken.connect(voter1).delegate(voter1.address);
    await governanceToken.connect(voter2).delegate(voter2.address);
    await governanceToken.connect(voter3).delegate(voter3.address);

    return {
      governance,
      governanceToken,
      treasuryContract,
      proposalFactory,
      mockToken,
      owner,
      proposer,
      voter1,
      voter2,
      voter3,
      guardian,
      treasury,
    };
  }

  describe("Advanced Governance", function () {
    it("Should create proposals with categories", async function () {
      const { governance, proposer } = await loadFixture(deployGovernanceFixture);
      
      const targets = [ethers.ZeroAddress];
      const values = [0];
      const calldatas = ["0x"];
      const title = "Test Proposal";
      const description = "A test proposal";
      const ipfsHash = "QmTest123";
      
      const proposalTx = await governance.connect(proposer).proposeWithCategory(
        targets,
        values,
        calldatas,
        title,
        description,
        ipfsHash,
        0 // ProposalCategory.Parameter
      );
      
      const receipt = await proposalTx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "ProposalCreatedWithCategory");
      
      expect(event).to.not.be.undefined;
      expect(event.args.proposer).to.equal(proposer.address);
      expect(event.args.category).to.equal(0);
    });

    it("Should enforce category-specific voting parameters", async function () {
      const { governance, proposer } = await loadFixture(deployGovernanceFixture);
      
      // Create emergency proposal (should have different parameters)
      const proposalTx = await governance.connect(proposer).proposeWithCategory(
        [ethers.ZeroAddress],
        [0],
        ["0x"],
        "Emergency Proposal",
        "Emergency action",
        "QmEmergency",
        3 // ProposalCategory.Emergency
      );
      
      const receipt = await proposalTx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "ProposalCreatedWithCategory");
      const proposalId = event.args.proposalId;
      
      const proposal = await governance.getEnhancedProposal(proposalId);
      expect(proposal.category).to.equal(3); // Emergency
    });

    it("Should handle vote delegation", async function () {
      const { governance, governanceToken, voter1, voter2 } = await loadFixture(deployGovernanceFixture);
      
      const initialVotes1 = await governanceToken.getVotes(voter1.address);
      const initialVotes2 = await governanceToken.getVotes(voter2.address);
      
      // Delegate voter1's votes to voter2
      await governance.connect(voter1).delegate(voter2.address);
      
      const finalVotes1 = await governanceToken.getVotes(voter1.address);
      const finalVotes2 = await governanceToken.getVotes(voter2.address);
      
      expect(finalVotes1).to.equal(0);
      expect(finalVotes2).to.equal(initialVotes1 + initialVotes2);
    });

    it("Should allow undelegation", async function () {
      const { governance, governanceToken, voter1, voter2 } = await loadFixture(deployGovernanceFixture);
      
      const originalVotes = await governanceToken.getVotes(voter1.address);
      
      // Delegate then undelegate
      await governance.connect(voter1).delegate(voter2.address);
      await governance.connect(voter1).undelegate();
      
      const finalVotes = await governanceToken.getVotes(voter1.address);
      expect(finalVotes).to.equal(originalVotes);
    });

    it("Should support voting with signatures", async function () {
      const { governance, proposer, voter1 } = await loadFixture(deployGovernanceFixture);
      
      // Create proposal
      const proposalTx = await governance.connect(proposer).propose(
        [ethers.ZeroAddress],
        [0],
        ["0x"],
        "Signature Test",
        "Test signature voting",
        "QmSig"
      );
      
      const receipt = await proposalTx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "ProposalCreated");
      const proposalId = event.args.proposalId;
      
      // Wait for voting to start
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]); // 3+ days
      await ethers.provider.send("evm_mine");
      
      // Create signature for voting
      const domain = {
        name: "DerivativesDAO",
        version: "1",
        chainId: await ethers.provider.getNetwork().then(n => n.chainId),
        verifyingContract: await governance.governanceToken()
      };
      
      const types = {
        Ballot: [
          { name: "proposalId", type: "uint256" },
          { name: "support", type: "uint8" }
        ]
      };
      
      const value = {
        proposalId: proposalId,
        support: 1 // For
      };
      
      const signature = await voter1.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);
      
      // Cast vote by signature
      await governance.castVoteBySig(proposalId, 1, v, r, s);
      
      const proposal = await governance.getProposal(proposalId);
      expect(proposal.forVotes).to.be.greaterThan(0);
    });

    it("Should queue and execute proposals with timelock", async function () {
      const { governance, proposer, voter1, voter2 } = await loadFixture(deployGovernanceFixture);
      
      // Create proposal
      const proposalTx = await governance.connect(proposer).propose(
        [ethers.ZeroAddress],
        [0],
        ["0x"],
        "Timelock Test",
        "Test timelock execution",
        "QmTimelock"
      );
      
      const receipt = await proposalTx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "ProposalCreated");
      const proposalId = event.args.proposalId;
      
      // Wait for voting to start and vote
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      
      await governance.connect(voter1).castVote(proposalId, 1); // For
      await governance.connect(voter2).castVote(proposalId, 1); // For
      
      // Wait for voting to end
      await ethers.provider.send("evm_increaseTime", [10 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      
      // Queue proposal
      await governance.queue(proposalId);
      
      let state = await governance.state(proposalId);
      expect(state).to.equal(5); // Queued
      
      // Wait for timelock
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      
      // Execute proposal
      await governance.execute(proposalId);
      
      state = await governance.state(proposalId);
      expect(state).to.equal(7); // Executed
    });

    it("Should handle emergency mode", async function () {
      const { governance, guardian, proposer } = await loadFixture(deployGovernanceFixture);
      
      // Enable emergency mode
      await governance.connect(guardian).setEmergencyMode(true);
      
      // Should only allow emergency proposals
      await expect(
        governance.connect(proposer).proposeWithCategory(
          [ethers.ZeroAddress],
          [0],
          ["0x"],
          "Regular Proposal",
          "Should fail",
          "QmFail",
          0 // Parameter category
        )
      ).to.be.revertedWith("Emergency mode active");
      
      // Emergency proposal should work
      await expect(
        governance.connect(proposer).proposeWithCategory(
          [ethers.ZeroAddress],
          [0],
          ["0x"],
          "Emergency Proposal",
          "Should work",
          "QmWork",
          3 // Emergency category
        )
      ).to.not.be.reverted;
    });
  });

  describe("Treasury", function () {
    it("Should collect and distribute revenue", async function () {
      const { treasuryContract, mockToken, owner } = await loadFixture(deployGovernanceFixture);
      
      // Mint tokens to treasury
      await mockToken.mint(treasuryContract.target, ethers.parseEther("1000"));
      
      // Collect revenue
      await mockToken.mint(owner.address, ethers.parseEther("100"));
      await mockToken.approve(treasuryContract.target, ethers.parseEther("100"));
      await treasuryContract.collectRevenue(mockToken.target, ethers.parseEther("100"));
      
      const revenueStream = await treasuryContract.getRevenueStream(mockToken.target);
      expect(revenueStream.totalCollected).to.equal(ethers.parseEther("100"));
    });

    it("Should create and manage grants", async function () {
      const { treasuryContract, mockToken, governance, voter1 } = await loadFixture(deployGovernanceFixture);
      
      // Mint tokens to treasury
      await mockToken.mint(treasuryContract.target, ethers.parseEther("1000"));
      
      // Create grant
      const grantAmount = ethers.parseEther("100");
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year
      const cliffDuration = 90 * 24 * 60 * 60; // 3 months
      
      await treasuryContract.connect(governance).createGrant(
        voter1.address,
        grantAmount,
        mockToken.target,
        "Development grant",
        vestingDuration,
        cliffDuration
      );
      
      const grantInfo = await treasuryContract.getGrantInfo(0);
      expect(grantInfo.recipient).to.equal(voter1.address);
      expect(grantInfo.amount).to.equal(grantAmount);
    });

    it("Should handle grant vesting and claiming", async function () {
      const { treasuryContract, mockToken, governance, voter1 } = await loadFixture(deployGovernanceFixture);
      
      // Setup grant
      await mockToken.mint(treasuryContract.target, ethers.parseEther("1000"));
      
      const grantAmount = ethers.parseEther("100");
      const vestingDuration = 365 * 24 * 60 * 60;
      const cliffDuration = 90 * 24 * 60 * 60;
      
      await treasuryContract.connect(governance).createGrant(
        voter1.address,
        grantAmount,
        mockToken.target,
        "Test grant",
        vestingDuration,
        cliffDuration
      );
      
      // Should not be able to claim before cliff
      await expect(
        treasuryContract.connect(voter1).claimGrant(0)
      ).to.be.revertedWith("No tokens to claim");
      
      // Fast forward past cliff
      await ethers.provider.send("evm_increaseTime", [cliffDuration + 1]);
      await ethers.provider.send("evm_mine");
      
      // Should be able to claim vested amount
      const initialBalance = await mockToken.balanceOf(voter1.address);
      await treasuryContract.connect(voter1).claimGrant(0);
      const finalBalance = await mockToken.balanceOf(voter1.address);
      
      expect(finalBalance).to.be.greaterThan(initialBalance);
    });
  });

  describe("Proposal Factory", function () {
    it("Should create risk parameter proposals", async function () {
      const { proposalFactory, proposer } = await loadFixture(deployGovernanceFixture);
      
      const riskParams = {
        symbol: "ETH/USD",
        initialMarginRatio: 1000,
        maintenanceMarginRatio: 600,
        liquidationFeeRatio: 100,
        maxLeverage: 10,
        maxPositionSize: ethers.parseEther("1000000")
      };
      
      const proposalId = await proposalFactory.connect(proposer).createRiskParameterProposal.staticCall(
        riskParams,
        "Update ETH/USD Risk Parameters",
        "Proposal to update risk parameters",
        "QmRisk"
      );
      
      await proposalFactory.connect(proposer).createRiskParameterProposal(
        riskParams,
        "Update ETH/USD Risk Parameters",
        "Proposal to update risk parameters",
        "QmRisk"
      );
      
      expect(proposalId).to.be.greaterThan(0);
    });

    it("Should create text-only proposals", async function () {
      const { proposalFactory, proposer } = await loadFixture(deployGovernanceFixture);
      
      const proposalId = await proposalFactory.connect(proposer).createTextProposal.staticCall(
        "Community Initiative",
        "Proposal for community discussion",
        "QmText"
      );
      
      await proposalFactory.connect(proposer).createTextProposal(
        "Community Initiative",
        "Proposal for community discussion",
        "QmText"
      );
      
      expect(proposalId).to.be.greaterThan(0);
    });

    it("Should validate proposal parameters", async function () {
      const { proposalFactory } = await loadFixture(deployGovernanceFixture);
      
      // Valid proposal
      const validResult = await proposalFactory.validateProposal(
        [ethers.ZeroAddress],
        [0],
        ["0x"]
      );
      expect(validResult.isValid).to.be.true;
      
      // Invalid proposal (no targets)
      const invalidResult = await proposalFactory.validateProposal(
        [],
        [],
        []
      );
      expect(invalidResult.isValid).to.be.false;
      expect(invalidResult.reason).to.equal("No targets specified");
    });

    it("Should get template information", async function () {
      const { proposalFactory } = await loadFixture(deployGovernanceFixture);
      
      const templateInfo = await proposalFactory.getTemplateInfo(0); // UpdateRiskParameters
      expect(templateInfo.name).to.equal("Risk Parameter Update");
      expect(templateInfo.category).to.equal(0); // Parameter category
    });
  });

  describe("Integration Tests", function () {
    it("Should handle complete governance workflow", async function () {
      const { 
        governance, 
        proposalFactory, 
        treasuryContract, 
        mockToken, 
        proposer, 
        voter1, 
        voter2 
      } = await loadFixture(deployGovernanceFixture);
      
      // Setup treasury with funds
      await mockToken.mint(treasuryContract.target, ethers.parseEther("1000"));
      
      // Create treasury transfer proposal
      const transferParams = {
        token: mockToken.target,
        recipient: voter1.address,
        amount: ethers.parseEther("100"),
        purpose: "Development funding"
      };
      
      const proposalId = await proposalFactory.connect(proposer).createTreasuryTransferProposal.staticCall(
        transferParams,
        "Fund Development",
        "Transfer funds for development",
        "QmDev"
      );
      
      await proposalFactory.connect(proposer).createTreasuryTransferProposal(
        transferParams,
        "Fund Development",
        "Transfer funds for development",
        "QmDev"
      );
      
      // Wait for voting period and vote
      await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60 + 1]); // 2+ days
      await ethers.provider.send("evm_mine");
      
      await governance.connect(voter1).castVote(proposalId, 1); // For
      await governance.connect(voter2).castVote(proposalId, 1); // For
      
      // Wait for voting to end
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]); // 7+ days
      await ethers.provider.send("evm_mine");
      
      // Queue and execute
      await governance.queue(proposalId);
      
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]); // 3+ days timelock
      await ethers.provider.send("evm_mine");
      
      const initialBalance = await mockToken.balanceOf(voter1.address);
      await governance.execute(proposalId);
      const finalBalance = await mockToken.balanceOf(voter1.address);
      
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("100"));
    });
  });
});
