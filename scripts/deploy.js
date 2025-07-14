const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Starting deployment...");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "Chain ID:", network.chainId);

  // Deployment addresses will be stored here
  const deployments = {};

  try {
    // 1. Deploy mock collateral token (USDC)
    console.log("Deploying MockERC20 (USDC)...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));
    await usdc.waitForDeployment();
    deployments.usdc = usdc.target;
    console.log("USDC deployed to:", usdc.target);

    // 2. Deploy governance token
    console.log("Deploying GovernanceToken...");
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const governanceToken = await GovernanceToken.deploy(deployer.address, deployer.address);
    await governanceToken.waitForDeployment();
    deployments.governanceToken = governanceToken.target;
    console.log("GovernanceToken deployed to:", governanceToken.target);

    // 3. Deploy price oracle
    console.log("Deploying PriceOracle...");
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    const priceOracle = await PriceOracle.deploy();
    await priceOracle.waitForDeployment();
    deployments.priceOracle = priceOracle.target;
    console.log("PriceOracle deployed to:", priceOracle.target);

    // 4. Deploy risk manager (with placeholder derivatives engine address)
    console.log("Deploying RiskManager...");
    const RiskManager = await ethers.getContractFactory("RiskManager");
    const riskManager = await RiskManager.deploy(ethers.ZeroAddress, priceOracle.target);
    await riskManager.waitForDeployment();
    deployments.riskManager = riskManager.target;
    console.log("RiskManager deployed to:", riskManager.target);

    // 5. Deploy derivatives engine
    console.log("Deploying DerivativesEngine...");
    const DerivativesEngine = await ethers.getContractFactory("DerivativesEngine");
    const derivativesEngine = await DerivativesEngine.deploy(
      priceOracle.target,
      riskManager.target,
      usdc.target
    );
    await derivativesEngine.waitForDeployment();
    deployments.derivativesEngine = derivativesEngine.target;
    console.log("DerivativesEngine deployed to:", derivativesEngine.target);

    // 6. Deploy governance
    console.log("Deploying Governance...");
    const Governance = await ethers.getContractFactory("Governance");
    const governance = await Governance.deploy(governanceToken.target);
    await governance.waitForDeployment();
    deployments.governance = governance.target;
    console.log("Governance deployed to:", governance.target);

    // 7. Configure contracts
    console.log("Configuring contracts...");

    // Set derivatives engine in risk manager
    await riskManager.setDerivativesEngine(derivativesEngine.target);

    // Add deployer as oracle for testing
    await priceOracle.addOracle(deployer.address, "DeployerOracle", 100);

    // Set initial prices
    await priceOracle.emergencySetPrice("ETH/USD", ethers.parseEther("2000"), 95);
    await priceOracle.emergencySetPrice("BTC/USD", ethers.parseEther("40000"), 95);

    // Add markets
    await derivativesEngine.addMarket("ETH/USD", 10); // 10x max leverage
    await derivativesEngine.addMarket("BTC/USD", 5);  // 5x max leverage

    // Enable governance token trading
    await governanceToken.enableTrading();

    console.log("Configuration completed successfully!");
    
    // Save deployment addresses
    const deploymentsDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    const deploymentFile = path.join(deploymentsDir, `${network.name}-${network.chainId}.json`);
    fs.writeFileSync(deploymentFile, JSON.stringify(deployments, null, 2));
    
    console.log("Deployment addresses saved to:", deploymentFile);
    
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
